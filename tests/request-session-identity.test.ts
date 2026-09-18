import assert from "node:assert/strict";
import test from "node:test";
import {
  readProductBearerToken,
  readRequestSessionIdentity,
} from "@/lib/server/request-session-identity";

function request(headers: HeadersInit = {}) {
  return new Request("https://command.example/api/hosted/session", { headers });
}

test("Cloudflare Access assertion remains the migration-first session identity", () => {
  assert.equal(
    readRequestSessionIdentity(request({
      "cf-access-jwt-assertion": "access-assertion",
      authorization: "Bearer product-token",
    })),
    "access-assertion",
  );
});

test("product bearer tokens are tagged before reaching a session provider", () => {
  const identity = readRequestSessionIdentity(
    request({ authorization: "Bearer workos-access-token" }),
  );
  assert.equal(identity, "product-bearer:workos-access-token");
  assert.equal(readProductBearerToken(identity), "workos-access-token");
});

test("missing or malformed authorization never becomes a session identity", () => {
  for (const authorization of [
    "",
    "Basic abc",
    "Bearer",
    "Bearer token with spaces",
    "Token abc",
  ]) {
    assert.equal(
      readRequestSessionIdentity(request({ authorization })),
      null,
    );
  }
});

test("product bearer extraction rejects untagged and malformed identities", () => {
  for (const identity of [
    null,
    undefined,
    "access-assertion",
    "product-bearer:",
    "product-bearer:token with spaces",
  ]) {
    assert.equal(readProductBearerToken(identity), null);
  }
});
