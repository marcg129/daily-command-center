import assert from "node:assert/strict";
import test from "node:test";
import type { CollectorCacheKey } from "@/lib/collector-cache";
import type { CollectorSnapshot, CollectorSnapshotRepository } from "@/lib/runtime/collector-snapshot-repository";
import type { RequestContext } from "@/lib/runtime/context";
import {
  HOSTED_INTEL_MAX_RESPONSE_BYTES,
  HOSTED_INTEL_QUERIES,
  HOSTED_INTEL_SCOPE,
  assertHostedIntelFetchUrl,
  collectAndStoreHostedIntel,
  collectHostedIntel,
  fetchHostedIntelFeed,
  hostedIntelQueryUrl,
  hostedIntelTldr,
  isHostedIntelRelevantStory,
  parseHostedIntelFeed,
  stripHostedIntelPublisherSuffix,
} from "@/lib/runtime/hosted-intel-collector";

const now = new Date("2026-09-13T01:00:00.000Z");
const recentDate = "Sun, 13 Sep 2026 00:30:00 GMT";

function feed(options: {
  title?: string;
  url?: string;
  publishedAt?: string;
  source?: string;
  description?: string;
} = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Google News</title><item>
<title>${options.title ?? "Critical Microsoft 365 security breach update"}</title>
<link>${options.url ?? "https://news.google.com/rss/articles/story-1"}</link>
<guid>story-1</guid>
<pubDate>${options.publishedAt ?? recentDate}</pubDate>
<description>${options.description ?? "Cybersecurity update for managed service providers and small businesses."}</description>
<source>${options.source ?? "Security Wire"}</source>
</item></channel></rss>`;
}

class FakeSnapshots implements CollectorSnapshotRepository {
  writes: Array<{
    context: RequestContext;
    collector: CollectorCacheKey;
    scope: string;
    payload: unknown;
    checkedAt: string;
  }> = [];

  async read<T>(): Promise<CollectorSnapshot<T> | null> { return null; }
  async write<T>(context: RequestContext, collector: CollectorCacheKey, scope: string, payload: T, checkedAt: string) {
    this.writes.push({ context, collector, scope, payload, checkedAt });
    return payload;
  }
  async updateArchive() { return false; }
}

test("hosted Intel outbound fetch is pinned to the fixed Google News RSS endpoint", async () => {
  const allowed = hostedIntelQueryUrl(HOSTED_INTEL_QUERIES[0].query);
  assert.equal(assertHostedIntelFetchUrl(allowed).hostname, "news.google.com");
  assert.throws(() => assertHostedIntelFetchUrl("http://news.google.com/rss/search?q=test"));
  assert.throws(() => assertHostedIntelFetchUrl("https://example.com/rss/search?q=test"));
  assert.throws(() => assertHostedIntelFetchUrl("https://news.google.com/other?q=test"));

  let observedRedirect = "";
  const xml = await fetchHostedIntelFeed(allowed, async (input, init) => {
    observedRedirect = String(init?.redirect ?? "");
    assert.equal(new URL(String(input)).hostname, "news.google.com");
    return new Response(feed(), { status: 200, headers: { "content-type": "application/rss+xml" } });
  });
  assert.equal(observedRedirect, "manual");
  assert.match(xml, /Microsoft 365/);
});

test("hosted Intel blocks redirects, oversized bodies, and unexpected content types", async () => {
  const allowed = hostedIntelQueryUrl(HOSTED_INTEL_QUERIES[0].query);
  await assert.rejects(
    fetchHostedIntelFeed(allowed, async () => new Response(null, {
      status: 302,
      headers: { location: "https://example.com/redirect" },
    })),
    /redirect was blocked/,
  );
  await assert.rejects(
    fetchHostedIntelFeed(allowed, async () => new Response("x", {
      status: 200,
      headers: {
        "content-type": "application/xml",
        "content-length": String(HOSTED_INTEL_MAX_RESPONSE_BYTES + 1),
      },
    })),
    /response-size limit/,
  );
  await assert.rejects(
    fetchHostedIntelFeed(allowed, async () => new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    })),
    /unexpected content type/,
  );
});

test("hosted Intel feed parsing keeps only dated HTTPS stories and removes duplicated publisher suffixes", () => {
  const valid = parseHostedIntelFeed(feed({
    title: "Florida investigates data breach tied to cybercriminal organization - Yahoo",
    source: "Yahoo",
  }), "Fallback");
  assert.equal(valid.length, 1);
  assert.equal(valid[0].source, "Yahoo");
  assert.equal(valid[0].title, "Florida investigates data breach tied to cybercriminal organization");
  assert.equal(valid[0].kind, "topic");
  assert.equal(stripHostedIntelPublisherSuffix("Security update - Example News", "Example News"), "Security update");

  assert.equal(parseHostedIntelFeed(feed({ url: "http://example.com/story" }), "Fallback").length, 0);
  assert.equal(parseHostedIntelFeed(feed({ publishedAt: "" }), "Fallback").length, 0);
  assert.equal(parseHostedIntelFeed(feed({ publishedAt: "Thu, 01 Jan 2099 12:00:00 GMT" }), "Fallback").length, 0);
});

test("hosted Intel requires real cyber context instead of scoring an ambiguous breach headline", () => {
  const physicalBreach = {
    title: "The Breach at Lal Chowk",
    summary: "The Breach at Lal Chowk Greater Kashmir",
  };
  const cyberBreach = {
    title: "Florida investigates data breach tied to cybercriminal organization",
    summary: "Florida officials are investigating a data breach tied to a cybercriminal organization.",
  };
  assert.equal(isHostedIntelRelevantStory(physicalBreach), false);
  assert.equal(isHostedIntelRelevantStory(cyberBreach), true);
});

test("hosted Intel turns duplicate feed descriptions into a concise non-duplicate TLDR", () => {
  const title = "Florida investigates data breach tied to cybercriminal organization";
  const tldr = hostedIntelTldr({
    title,
    source: "Yahoo",
    summary: `${title} - Yahoo`,
  });
  assert.notEqual(tldr.toLowerCase(), title.toLowerCase());
  assert.match(tldr, /data-security incident/i);
  assert.ok(tldr.length < 200);

  const useful = hostedIntelTldr({
    title: "CISA warns of exploited flaw",
    source: "Security Wire",
    summary: "Federal defenders added the flaw to the exploited vulnerabilities catalog and urged rapid patching.",
  });
  assert.match(useful, /Federal defenders added the flaw/);
});

test("hosted Intel uses the fixed query set, degrades on partial failure, and keeps output bounded", async () => {
  const requested: string[] = [];
  const payload = await collectHostedIntel({
    now,
    fetcher: async (input) => {
      const url = new URL(String(input));
      const query = url.searchParams.get("q") ?? "";
      requested.push(query);
      if (query.includes("Microsoft 365")) throw new Error("provider unavailable");
      if (query.includes("cyberattack")) {
        return new Response(feed({
          title: "The Breach at Lal Chowk - Greater Kashmir",
          source: "Greater Kashmir",
          description: "The Breach at Lal Chowk Greater Kashmir",
        }), { headers: { "content-type": "application/rss+xml" } });
      }
      return new Response(feed(), { headers: { "content-type": "application/rss+xml" } });
    },
  });

  assert.deepEqual(new Set(requested), new Set(HOSTED_INTEL_QUERIES.map(({ query }) => query)));
  assert.equal(payload.errors.length, 1);
  assert.match(payload.errors[0], /Microsoft 365 security/);
  assert.equal(payload.providerStatuses?.[0]?.state, "degraded");
  assert.ok(payload.items.length <= 24);
  assert.ok(payload.items.length >= 1);
  assert.ok(payload.items.every((item) => item.id.startsWith("hosted-industry:")));
  assert.ok(payload.items.every((item) => typeof item.importanceScore === "number"));
  assert.ok(payload.items.every((item) => item.title !== "The Breach at Lal Chowk"));
  assert.ok((payload.filteredOut ?? 0) >= 1);
  assert.ok(payload.items.every((item) => item.summary && item.summary !== item.title));
});

test("a total provider failure preserves the prior D1 snapshot by refusing to write", async () => {
  const snapshots = new FakeSnapshots();
  await assert.rejects(
    collectAndStoreHostedIntel(snapshots, {
      now,
      fetcher: async () => { throw new Error("network unavailable"); },
    }),
    /failed for every fixed query/,
  );
  assert.equal(snapshots.writes.length, 0);
});

test("successful collection writes exactly one Indelitech industry snapshot", async () => {
  const snapshots = new FakeSnapshots();
  const payload = await collectAndStoreHostedIntel(snapshots, {
    now,
    fetcher: async () => new Response(feed(), { headers: { "content-type": "application/rss+xml" } }),
  });
  assert.equal(snapshots.writes.length, 1);
  const write = snapshots.writes[0];
  assert.deepEqual(write.context, { workspaceId: "indelitech" });
  assert.equal(write.collector, "industry");
  assert.equal(write.scope, HOSTED_INTEL_SCOPE);
  assert.equal(write.checkedAt, payload.checkedAt);
  assert.equal(write.payload, payload);
});
