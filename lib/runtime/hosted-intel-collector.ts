import { XMLParser } from "fast-xml-parser";
import { filterFreshStories, filterPlausiblyDatedStories, INDUSTRY_FRESHNESS_HOURS } from "../freshness";
import { curateIndustryDiscoveries } from "../industry-curation";
import type { CollectorSnapshotRepository } from "./collector-snapshot-repository";
import { INDELITECH_WORKSPACE_ID } from "./context";
import type { IndustrySourceStatus, LiveFeedResponse, LiveStory } from "../types";

export const HOSTED_INTEL_SCOPE = "hosted-indelitech-intel-v1";
export const HOSTED_INTEL_MAX_RESPONSE_BYTES = 2_000_000;
export const HOSTED_INTEL_TIMEOUT_MS = 12_000;
export const HOSTED_INTEL_SURFACED_LIMIT = 24;

export const HOSTED_INTEL_QUERIES = [
  { id: "msp-security", label: "MSP security", query: '("managed service provider" OR MSP) (cybersecurity OR security OR breach) when:1d' },
  { id: "small-business-security", label: "Small-business security", query: '("small business" OR SMB) (cybersecurity OR ransomware OR breach) when:1d' },
  { id: "microsoft-365-security", label: "Microsoft 365 security", query: '"Microsoft 365" (security OR vulnerability OR breach OR phishing) when:1d' },
  { id: "ransomware-breach", label: "Ransomware and breaches", query: '(ransomware OR breach) (business OR organization) when:1d' },
  { id: "cisa-advisories", label: "CISA and advisories", query: '(CISA OR "security advisory") (vulnerability OR exploit OR cybersecurity) when:1d' },
] as const;

const TOPIC_TERMS = [
  "managed service provider",
  "MSP",
  "small business",
  "SMB",
  "cybersecurity",
  "Microsoft 365",
  "ransomware",
  "breach",
  "CISA",
  "vulnerability",
  "phishing",
] as const;

const PRIORITY_TERMS = [
  "actively exploited",
  "zero-day",
  "ransomware",
  "breach",
  "critical vulnerability",
  "CISA",
  "Microsoft 365",
  "managed service provider",
] as const;

const EXCLUDED_TERMS = [
  "sports betting",
  "fantasy football",
  "celebrity",
  "gaming review",
] as const;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
});

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type RawFeedItem = Record<string, unknown>;

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanText(value: unknown) {
  if (Array.isArray(value)) return cleanText(value[0]);
  if (typeof value === "object" && value) {
    const record = value as Record<string, unknown>;
    return cleanText(record["#text"] ?? record.title ?? record.name);
  }
  return (typeof value === "string" || typeof value === "number" ? String(value) : "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHttpsUrl(value: unknown) {
  const text = cleanText(value);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function feedSource(item: RawFeedItem, fallback: string) {
  const source = item.source;
  const cleaned = cleanText(source);
  return cleaned || fallback;
}

export function parseHostedIntelFeed(xml: string, fallbackSource: string) {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const rss = parsed.rss as { channel?: Record<string, unknown> } | undefined;
  const atom = parsed.feed as Record<string, unknown> | undefined;
  const channel = rss?.channel;
  const items = channel
    ? arrayify(channel.item as RawFeedItem | RawFeedItem[] | undefined)
    : arrayify(atom?.entry as RawFeedItem | RawFeedItem[] | undefined);

  const stories = items.flatMap((item): LiveStory[] => {
    const title = cleanText(item.title);
    const url = cleanHttpsUrl(item.link);
    const publishedAt = cleanText(item.pubDate ?? item.published ?? item.updated);
    if (!title || !url || !publishedAt) return [];
    return [{
      id: cleanText(item.guid ?? item.id) || url,
      title,
      summary: cleanText(item.description ?? item.summary ?? item.content).slice(0, 420),
      url,
      source: feedSource(item, fallbackSource),
      publishedAt,
      kind: "topic",
    }];
  });
  return filterPlausiblyDatedStories(stories);
}

export function hostedIntelQueryUrl(query: string) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  return url.toString();
}

export function assertHostedIntelFetchUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "news.google.com" || url.pathname !== "/rss/search") {
    throw new Error("Hosted Intel attempted an unapproved outbound destination.");
  }
  return url;
}

async function readBoundedText(response: Response, maxBytes = HOSTED_INTEL_MAX_RESPONSE_BYTES) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Hosted Intel source exceeded the response-size limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Hosted Intel source exceeded the response-size limit.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export async function fetchHostedIntelFeed(
  value: string,
  fetcher: FetchLike = fetch,
) {
  const url = assertHostedIntelFetchUrl(value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HOSTED_INTEL_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("Hosted Intel source redirect was blocked.");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Hosted Intel source returned HTTP ${response.status}.`);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (contentType && !/(?:xml|rss|atom|text)/.test(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("Hosted Intel source returned an unexpected content type.");
    }
    return readBoundedText(response);
  } finally {
    clearTimeout(timer);
  }
}

export async function collectHostedIntel(
  options: { fetcher?: FetchLike; now?: Date } = {},
): Promise<LiveFeedResponse> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const checkedAt = now.toISOString();
  const fetcher = options.fetcher ?? fetch;
  const results = await Promise.allSettled(HOSTED_INTEL_QUERIES.map(async (source) => {
    const xml = await fetchHostedIntelFeed(hostedIntelQueryUrl(source.query), fetcher);
    const items = filterFreshStories(parseHostedIntelFeed(xml, source.label), INDUSTRY_FRESHNESS_HOURS, nowMs)
      .map((item) => ({ ...item, collectionScope: `hosted-query:${source.id}` }));
    return { source, items };
  }));

  const discoveries: LiveStory[] = [];
  const errors: string[] = [];
  const sourceStatuses: IndustrySourceStatus[] = [];
  let successfulQueries = 0;
  results.forEach((result, index) => {
    const source = HOSTED_INTEL_QUERIES[index];
    if (result.status === "fulfilled") {
      successfulQueries += 1;
      discoveries.push(...result.value.items);
      sourceStatuses.push({
        sourceId: source.id,
        source: source.label,
        mode: "topics",
        endpoint: hostedIntelQueryUrl(source.query),
        state: "live",
        message: `${result.value.items.length} fresh result${result.value.items.length === 1 ? "" : "s"} collected.`,
      });
    } else {
      const message = result.reason instanceof Error ? result.reason.message : "Source could not be read.";
      errors.push(`${source.label}: ${message}`);
      sourceStatuses.push({
        sourceId: source.id,
        source: source.label,
        mode: "topics",
        endpoint: hostedIntelQueryUrl(source.query),
        state: "unchanged",
        message: "Collection failed for this query; other sources were still processed.",
      });
    }
  });

  const curated = curateIndustryDiscoveries(discoveries, {
    now: nowMs,
    limit: HOSTED_INTEL_SURFACED_LIMIT,
    minimumScore: 42,
    topicTerms: TOPIC_TERMS,
    priorityTerms: PRIORITY_TERMS,
    excludeTerms: EXCLUDED_TERMS,
    maxPerSource: 4,
  });
  const items: LiveStory[] = curated.selected.map((candidate) => ({
    ...candidate.item,
    id: `hosted-industry:${candidate.discoveryId}`,
    importanceScore: candidate.score,
    importanceReason: candidate.reasons.slice(0, 3).join(" · ") || "Ranked as a timely Indelitech-relevant update.",
  }));

  return {
    configured: true,
    checkedAt,
    items,
    errors,
    sourceStatuses,
    freshnessHours: INDUSTRY_FRESHNESS_HOURS,
    discoveredCount: discoveries.length,
    surfacedLimit: HOSTED_INTEL_SURFACED_LIMIT,
    curationMode: "local",
    providerStatuses: [{
      provider: "Hosted RSS collector",
      state: successfulQueries ? (successfulQueries === HOSTED_INTEL_QUERIES.length ? "live" : "degraded") : "degraded",
      message: `${successfulQueries}/${HOSTED_INTEL_QUERIES.length} fixed queries succeeded; ${items.length} updates surfaced from ${discoveries.length} fresh discoveries.`,
    }],
    archivedItems: [],
    archiveCount: 0,
    historyItems: [],
    historyCount: 0,
  };
}

export async function collectAndStoreHostedIntel(
  snapshots: CollectorSnapshotRepository,
  options: { fetcher?: FetchLike; now?: Date } = {},
) {
  const payload = await collectHostedIntel(options);
  await snapshots.write(
    { workspaceId: INDELITECH_WORKSPACE_ID },
    "industry",
    HOSTED_INTEL_SCOPE,
    payload,
    payload.checkedAt,
  );
  return payload;
}
