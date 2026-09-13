import assert from "node:assert/strict";
import test from "node:test";
import type { CollectorCacheKey } from "@/lib/collector-cache";
import type { CollectorSnapshot, CollectorSnapshotRepository } from "@/lib/runtime/collector-snapshot-repository";
import { hostedIntelSnapshotResponse, normalizeHostedIntelStory } from "@/lib/runtime/hosted-intel";
import type { ProductWorkspaceId, RequestContext } from "@/lib/runtime/context";
import type { Clock } from "@/lib/runtime/primitives";
import { InMemorySessionProvider, principalId, type AuthenticatedSession } from "@/lib/runtime/session";
import { FakeWorkspaceResolver } from "@/lib/runtime/workspace-resolver";
import { createAuthorizedHostedIntelHandler } from "@/lib/server/authorized-hosted-intel-handler";
import type { LiveFeedResponse } from "@/lib/types";

const now = "2026-09-12T20:00:00.000Z";
const clock: Clock = { now: () => new Date(now) };
const alice = principalId("principal-alice");
const session: AuthenticatedSession = {
  sessionId: "verified-session",
  principal: { principalId: alice },
  expiresAt: "2026-09-12T21:00:00.000Z",
};

function feed(checkedAt = "2026-09-12T19:30:00.000Z"): CollectorSnapshot<LiveFeedResponse> {
  return {
    scope: "indelitech-intel-v1",
    checkedAt,
    payload: {
      configured: true,
      checkedAt,
      freshnessHours: 24,
      errors: [],
      items: [{
        id: "story-1",
        title: "Security update",
        summary: "Useful context",
        url: "https://example.com/security-update",
        source: "Example Security",
        publishedAt: "2026-09-12T18:00:00.000Z",
        importanceReason: "Relevant to managed security operations.",
      }],
    },
  };
}

class FakeSnapshots implements CollectorSnapshotRepository {
  reads: Array<{ context: RequestContext; collector: CollectorCacheKey; scope?: string }> = [];
  fail = false;
  constructor(public snapshot: CollectorSnapshot<LiveFeedResponse> | null) {}
  async read<T>(context: RequestContext, collector: CollectorCacheKey, scope?: string) {
    this.reads.push({ context, collector, scope });
    if (this.fail) throw new Error("SQL binding secret should not escape");
    return this.snapshot as CollectorSnapshot<T> | null;
  }
  async write<T>(_context: RequestContext, _collector: CollectorCacheKey, _scope: string, payload: T) { return payload; }
  async updateArchive() { return false; }
}

function request(workspaceId = "indelitech", assertion = "assertion") {
  return new Request(`https://command.example/api/hosted/intel?workspaceId=${workspaceId}`, {
    headers: assertion ? { "cf-access-jwt-assertion": assertion } : undefined,
  });
}

function fixture(
  snapshot: CollectorSnapshot<LiveFeedResponse> | null = feed(),
  grants: ReadonlySet<ProductWorkspaceId> = new Set<ProductWorkspaceId>(["indelitech"]),
) {
  const snapshots = new FakeSnapshots(snapshot);
  const handlers = createAuthorizedHostedIntelHandler(
    new InMemorySessionProvider(new Map([["assertion", session]])),
    new FakeWorkspaceResolver(new Map([[alice, grants]])),
    snapshots,
    clock,
  );
  return { snapshots, handlers };
}

test("hosted Intel sanitizes story URLs and optional display fields", () => {
  assert.equal(normalizeHostedIntelStory({
    id: "unsafe", title: "Unsafe", source: "Bad", publishedAt: now,
    url: "javascript:alert(1)", summary: "Nope",
  }), null);
  assert.deepEqual(normalizeHostedIntelStory({
    id: "safe", title: "Safe", source: "Source", publishedAt: now,
    url: "https://example.com/item", summary: "Summary", importanceScore: 91,
    importanceReason: "Important", aiSummary: "Short summary", unexpected: "drop me",
  }), {
    id: "safe", title: "Safe", source: "Source", publishedAt: now,
    url: "https://example.com/item", summary: "Summary", importanceScore: 91,
    importanceReason: "Important", aiSummary: "Short summary",
  });
});

test("hosted Intel reports empty, current, and stale snapshots truthfully", () => {
  assert.equal(hostedIntelSnapshotResponse(null, new Date(now)).status, "empty");
  const current = hostedIntelSnapshotResponse(feed(), new Date(now));
  assert.equal(current.status, "current");
  assert.equal(current.items.length, 1);
  assert.equal(current.workspaceId, "indelitech");
  const stale = hostedIntelSnapshotResponse(feed("2026-09-10T10:00:00.000Z"), new Date(now));
  assert.equal(stale.status, "stale");
});

test("hosted Intel requires Access authentication and the exact Indelitech grant before snapshot reads", async () => {
  const missing = fixture();
  assert.equal((await missing.handlers.GET(request("indelitech", ""))).status, 403);
  assert.equal(missing.snapshots.reads.length, 0);

  const personal = fixture();
  assert.equal((await personal.handlers.GET(request("personal"))).status, 400);
  assert.equal(personal.snapshots.reads.length, 0);

  const denied = fixture(feed(), new Set<ProductWorkspaceId>(["personal"]));
  assert.equal((await denied.handlers.GET(request())).status, 403);
  assert.equal(denied.snapshots.reads.length, 0);
});

test("authorized hosted Intel reads only the Indelitech industry snapshot", async () => {
  const { snapshots, handlers } = fixture();
  const response = await handlers.GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(snapshots.reads, [{ context: { workspaceId: "indelitech" }, collector: "industry", scope: undefined }]);
  const body = await response.json() as { workspaceId: string; status: string; items: Array<{ id: string }> };
  assert.equal(body.workspaceId, "indelitech");
  assert.equal(body.status, "current");
  assert.deepEqual(body.items.map(({ id }) => id), ["story-1"]);
});

test("hosted Intel failures are bounded and do not expose persistence details", async () => {
  const { snapshots, handlers } = fixture();
  snapshots.fail = true;
  const response = await handlers.GET(request());
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.deepEqual(body, { error: "Hosted Intel could not be read safely." });
  assert.doesNotMatch(JSON.stringify(body).toLowerCase(), /sql|binding|secret|principal|jwt/);
});
