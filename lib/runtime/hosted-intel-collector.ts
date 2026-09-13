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
  { id: "msp-security", label: "MSP security", query: '("managed service provider" OR MSP) (cybersecurity OR ransomware OR "data breach" OR phishing OR vulnerability) when:1d' },
  { id: "small-business-security", label: "Small-business security", query: '("small business" OR SMB) (cybersecurity OR ransomware OR "data breach" OR phishing) when:1d' },
  { id: "microsoft-365-security", label: "Microsoft 365 security", query: '"Microsoft 365" (security OR vulnerability OR "data breach" OR phishing) when:1d' },
  { id: "ransomware-breach", label: "Ransomware and breaches", query: '(ransomware OR "data breach" OR cyberattack OR "cyber attack") (business OR company OR organization) when:1d' },
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
  "data breach",
  "cyberattack",
  "malware",
  "CISA",
  "vulnerability",
  "phishing",
] as const;

const PRIORITY_TERMS = [
  "actively exploited",
  "zero-day",
  "ransomware",
  "data breach",
  "cyberattack",
  "critical vulnerability",
  "CISA",
  "Microsoft 365",
  "managed service provider",
  "phishing",
  "Florida",
  "South Florida",
] as const;

const EXCLUDED_TERMS = [
  "sports betting",
  "fantasy football",
  "celebrity",
  "gaming review",
] as const;

const SOURCE_PRIORITIES: Readonly<Record<string, number>> = {
  cisa: 18,
  microsoft: 14,
  bleepingcomputer: 12,
  "krebs on security": 12,
  "the hacker news": 10,
  securityweek: 10,
  "dark reading": 8,
  "sc media": 8,
};

const STRONG_CYBER_CONTEXT = [
  "cybersecurity",
  "cyber attack",
  "cyberattack",
  "cyber incident",
  "cybercriminal",
  "ransomware",
  "malware",
  "phishing",
  "data breach",
  "data leak",
  "data exposure",
  "vulnerability",
  "zero-day",
  "zero day",
  "exploit",
  "actively exploited",
  "cve",
  "hacked",
  "hacking",
  "hacker",
  "hackers",
  "credential theft",
  "credential stealing",
  "account takeover",
  "identity theft",
  "botnet",
  "infostealer",
  "threat actor",
  "incident response",
] as const;

const SECURITY_ANCHORS = [
  "managed service provider",
  "msp",
  "microsoft 365",
  "cisa",
  "cloud security",
  "email security",
  "endpoint security",
  "network security",
] as const;

const AMBIGUOUS_SECURITY_TERMS = [
  "breach",
  "security",
  "attack",
  "compromise",
] as const;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
});

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type RawFeedItem = Record<string, unknown>;

type IntelSummaryInput = Readonly<{
  title: string;
  summary?: string;
  source?: string;
}>;

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

function normalizedText(value: string) {
  return cleanText(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(context: string, phrase: string) {
  const normalizedContext = ` ${normalizedText(context)} `;
  const normalizedPhrase = normalizedText(phrase);
  return Boolean(normalizedPhrase) && normalizedContext.includes(` ${normalizedPhrase} `);
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
  const cleaned = cleanText(item.source);
  return cleaned || fallback;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripHostedIntelPublisherSuffix(value: string, source = "") {
  const cleaned = cleanText(value);
  const publisher = cleanText(source);
  if (!cleaned || !publisher) return cleaned;
  return cleaned.replace(new RegExp(`\\s+(?:[-|–—:]\\s*)${escapeRegExp(publisher)}\\s*$`, "i"), "").trim();
}

function summarySimilarity(title: string, summary: string) {
  const titleTokens = new Set(normalizedText(title).split(" ").filter(Boolean));
  const summaryTokens = new Set(normalizedText(summary).split(" ").filter(Boolean));
  if (!titleTokens.size || !summaryTokens.size) return 0;
  let shared = 0;
  for (const token of titleTokens) if (summaryTokens.has(token)) shared += 1;
  return shared / Math.max(titleTokens.size, summaryTokens.size);
}

function meaningfulFeedSummary({ title, summary = "", source = "" }: IntelSummaryInput) {
  const cleaned = stripHostedIntelPublisherSuffix(cleanText(summary), source);
  if (!cleaned) return "";
  const normalizedTitle = normalizedText(title);
  const normalizedSummary = normalizedText(cleaned);
  if (!normalizedSummary || normalizedSummary === normalizedTitle) return "";
  if (normalizedSummary.startsWith(`${normalizedTitle} `) && normalizedSummary.length <= normalizedTitle.length + 40) return "";
  if (summarySimilarity(title, cleaned) >= 0.82 && cleaned.length <= title.length + 80) return "";
  return cleaned;
}

function compactSentence(value: string, maxLength = 190) {
  const cleaned = cleanText(value);
  if (!cleaned) return "";
  const clipped = cleaned.length <= maxLength
    ? cleaned
    : `${cleaned.slice(0, Math.max(1, maxLength - 1)).replace(/\s+\S*$/, "").trim()}…`;
  return /[.!?…]$/.test(clipped) ? clipped : `${clipped}.`;
}

export function hostedIntelTldr(story: IntelSummaryInput) {
  const feedSummary = meaningfulFeedSummary(story);
  if (feedSummary) return compactSentence(feedSummary);

  const context = `${story.title} ${story.summary || ""}`;
  if (containsPhrase(context, "data breach") || containsPhrase(context, "data leak") || containsPhrase(context, "data exposure")) {
    return "A newly reported data-security incident may affect sensitive information and is worth reviewing for incident-response and client-risk lessons.";
  }
  if (containsPhrase(context, "ransomware")) {
    return "A ransomware incident or campaign is creating operational risk and may offer useful defensive or recovery lessons for small organizations.";
  }
  if (containsPhrase(context, "CISA") || containsPhrase(context, "vulnerability") || containsPhrase(context, "zero-day") || containsPhrase(context, "actively exploited")) {
    return "A vulnerability or exploitation alert may require patching, mitigation, or exposure review in managed environments.";
  }
  if (containsPhrase(context, "Microsoft 365") || containsPhrase(context, "phishing") || containsPhrase(context, "credential")) {
    return "An identity, email, or Microsoft 365 security development may affect tenant hardening and user-protection decisions.";
  }
  if (containsPhrase(context, "managed service provider") || containsPhrase(context, "MSP")) {
    return "An MSP-focused security development may affect service-provider operations, tooling, or client defenses.";
  }
  if (containsPhrase(context, "cyberattack") || containsPhrase(context, "cyber attack") || containsPhrase(context, "cybersecurity")) {
    return "A current cybersecurity development may have operational or defensive implications for small organizations and managed IT environments.";
  }
  return "A recent security development passed Indelitech's relevance filter and may warrant a quick review.";
}

export function isHostedIntelRelevantStory(story: Pick<LiveStory, "title" | "summary">) {
  const context = `${story.title} ${story.summary || ""}`;
  if (STRONG_CYBER_CONTEXT.some((term) => containsPhrase(context, term))) return true;
  const anchored = SECURITY_ANCHORS.some((term) => containsPhrase(context, term));
  const securitySignal = AMBIGUOUS_SECURITY_TERMS.some((term) => containsPhrase(context, term));
  return anchored && securitySignal;
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
    const source = feedSource(item, fallbackSource);
    const title = stripHostedIntelPublisherSuffix(cleanText(item.title), source);
    const url = cleanHttpsUrl(item.link);
    const publishedAt = cleanText(item.pubDate ?? item.published ?? item.updated);
    if (!title || !url || !publishedAt) return [];
    return [{
      id: cleanText(item.guid ?? item.id) || url,
      title,
      summary: cleanText(item.description ?? item.summary ?? item.content).slice(0, 420),
      url,
      source,
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
    const freshItems = filterFreshStories(parseHostedIntelFeed(xml, source.label), INDUSTRY_FRESHNESS_HOURS, nowMs);
    const items = freshItems
      .filter(isHostedIntelRelevantStory)
      .map((item) => ({
        ...item,
        summary: hostedIntelTldr(item),
        collectionScope: `hosted-query:${source.id}`,
      }));
    return { source, items, freshCount: freshItems.length, filteredOut: freshItems.length - items.length };
  }));

  const discoveries: LiveStory[] = [];
  const errors: string[] = [];
  const sourceStatuses: IndustrySourceStatus[] = [];
  let successfulQueries = 0;
  let freshDiscoveryCount = 0;
  let filteredOut = 0;
  results.forEach((result, index) => {
    const source = HOSTED_INTEL_QUERIES[index];
    if (result.status === "fulfilled") {
      successfulQueries += 1;
      freshDiscoveryCount += result.value.freshCount;
      filteredOut += result.value.filteredOut;
      discoveries.push(...result.value.items);
      sourceStatuses.push({
        sourceId: source.id,
        source: source.label,
        mode: "topics",
        endpoint: hostedIntelQueryUrl(source.query),
        state: "live",
        message: `${result.value.items.length} relevant of ${result.value.freshCount} fresh result${result.value.freshCount === 1 ? "" : "s"} collected.`,
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

  if (!successfulQueries) {
    throw new Error("Hosted Intel collection failed for every fixed query.");
  }

  const curated = curateIndustryDiscoveries(discoveries, {
    now: nowMs,
    limit: HOSTED_INTEL_SURFACED_LIMIT,
    minimumScore: 50,
    topicTerms: TOPIC_TERMS,
    priorityTerms: PRIORITY_TERMS,
    excludeTerms: EXCLUDED_TERMS,
    sourcePriorities: SOURCE_PRIORITIES,
    maxPerSource: 3,
    eventSimilarityThreshold: 0.68,
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
    filteredOut,
    freshnessHours: INDUSTRY_FRESHNESS_HOURS,
    discoveredCount: freshDiscoveryCount,
    surfacedLimit: HOSTED_INTEL_SURFACED_LIMIT,
    curationMode: "local",
    providerStatuses: [{
      provider: "Hosted RSS collector",
      state: successfulQueries === HOSTED_INTEL_QUERIES.length ? "live" : "degraded",
      message: `${successfulQueries}/${HOSTED_INTEL_QUERIES.length} fixed queries succeeded; ${items.length} updates surfaced from ${discoveries.length} relevant results after filtering ${filteredOut} off-topic item${filteredOut === 1 ? "" : "s"} from ${freshDiscoveryCount} fresh discoveries.`,
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
