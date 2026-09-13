import { INDUSTRY_FRESHNESS_HOURS, isFreshTimestamp } from "@/lib/freshness";
import type { CollectorSnapshot } from "@/lib/runtime/collector-snapshot-repository";
import type { LiveFeedResponse, LiveStory } from "@/lib/types";

export type HostedIntelStatus = "empty" | "current" | "stale";

export type HostedIntelSnapshotResponse = Readonly<{
  workspaceId: "indelitech";
  status: HostedIntelStatus;
  checkedAt: string | null;
  freshnessHours: number;
  configured: boolean;
  items: LiveStory[];
  errors: string[];
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function httpUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function normalizeHostedIntelStory(value: unknown): LiveStory | null {
  const item = record(value);
  if (!item) return null;
  const id = optionalString(item.id);
  const title = optionalString(item.title);
  const source = optionalString(item.source);
  const publishedAt = optionalString(item.publishedAt);
  const url = httpUrl(item.url);
  if (!id || !title || !source || !publishedAt || !url) return null;

  const story: LiveStory = {
    id,
    title,
    source,
    publishedAt,
    url,
    summary: typeof item.summary === "string" ? item.summary : "",
  };
  const importanceReason = optionalString(item.importanceReason);
  const aiSummary = optionalString(item.aiSummary);
  const discoveredAt = optionalString(item.discoveredAt);
  const importanceScore = typeof item.importanceScore === "number" && Number.isFinite(item.importanceScore)
    ? item.importanceScore
    : undefined;
  if (importanceReason) story.importanceReason = importanceReason;
  if (aiSummary) story.aiSummary = aiSummary;
  if (discoveredAt) story.discoveredAt = discoveredAt;
  if (importanceScore !== undefined) story.importanceScore = importanceScore;
  return story;
}

function boundedFreshnessHours(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 168
    ? value
    : INDUSTRY_FRESHNESS_HOURS;
}

export function hostedIntelSnapshotResponse(
  snapshot: CollectorSnapshot<LiveFeedResponse> | null,
  now: Date,
): HostedIntelSnapshotResponse {
  if (!snapshot) {
    return {
      workspaceId: "indelitech",
      status: "empty",
      checkedAt: null,
      freshnessHours: INDUSTRY_FRESHNESS_HOURS,
      configured: false,
      items: [],
      errors: [],
    };
  }

  const payload = record(snapshot.payload);
  const freshnessHours = boundedFreshnessHours(payload?.freshnessHours);
  const items = Array.isArray(payload?.items)
    ? payload.items.map(normalizeHostedIntelStory).filter((item): item is LiveStory => item !== null).slice(0, 50)
    : [];
  const errors = Array.isArray(payload?.errors)
    ? payload.errors.filter((error): error is string => typeof error === "string").slice(0, 10)
    : [];
  const current = isFreshTimestamp(snapshot.checkedAt, freshnessHours, now.getTime());

  return {
    workspaceId: "indelitech",
    status: current ? "current" : "stale",
    checkedAt: snapshot.checkedAt,
    freshnessHours,
    configured: payload?.configured === true,
    items,
    errors,
  };
}
