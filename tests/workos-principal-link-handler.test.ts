import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ApplicationUserAccessError,
  applicationUserId,
  type ApplicationUserResolver,
  type AuthorizedWorkspace,
} from "@/lib/runtime/application-user";
import {
  InMemorySessionProvider,
  principalId,
  type AuthenticatedSession,
} from "@/lib/runtime/session";
import type { ApplicationPrincipalLinker } from "@/lib/server/d1-application-principal-linker";
import { createAuthorizedWorkOSPrincipalLinkHandler } from "@/lib/server/authorized-workos-principal-link-handler";

const now = new Date("2026-09-19T02:00:00.000Z");
const expiresAt = "2026-09-19T03:00:00.000Z";
const workspaces: AuthorizedWorkspace[] = [
  {
    workspaceId: "personal",
    displayName: "Personal",
    workspaceType: "PERSONAL",
    themeKey: "personal-tech-blue",
    role: "OWNER",
  },
  {
    workspaceId: "indelitech",
    displayName: "Indelitech",
    workspaceType: "BUSINESS",
    themeKey: "indelitech",
    role: "OWNER",
  },
];

function session(id: string, principal: string): AuthenticatedSession {
  return {
    sessionId: id,
    principal: { principalId: principalId(principal) },
    expiresAt,
  };
}

function request(includeCloudflare = true, includeWorkOS = true) {
  const headers = new Headers();
  if (includeCloudflare) headers.set("cf-access-jwt-assertion", "cf-token");
  if (includeWorkOS) headers.set("cookie", "dcc-workos-access=workos-token");
  return new Request("https://command.example/api/auth/workos/link", {
    method: "POST",
    headers,
  });
}

test("dual-provider link attaches WorkOS to the already-resolved Cloudflare DCC user", async () => {
  let linked = false;
  let linkCalls = 0;
  const cloudflare = new InMemorySessionProvider(new Map([
    ["cf-token", session("cf", "cf-user:marc")],
  ]));
  const workos = new InMemorySessionProvider(new Map([
    ["product-bearer:workos-token", session("workos", "workos-user:user_01HBEQKA6K4QJAS93VPE39W1JT")],
  ]));

  const resolver: ApplicationUserResolver = {
    async resolve(principal) {
      if (principal.principalId === "cf-user:marc") {
        return { userId: applicationUserId("user:marc"), workspaces };
      }
      if (
        linked &&
        principal.principalId === "workos-user:user_01HBEQKA6K4QJAS93VPE39W1JT"
      ) {
        return { userId: applicationUserId("user:marc"), workspaces };
      }
      throw new ApplicationUserAccessError();
    },
  };
  const linker: ApplicationPrincipalLinker = {
    async link(input) {
      linkCalls += 1;
      assert.equal(input.userId, "user:marc");
      assert.equal(
        input.principalId,
        "workos-user:user_01HBEQKA6K4QJAS93VPE39W1JT",
      );
      assert.equal(input.provider, "WORKOS_AUTHKIT");
      linked = true;
    },
  };

  const response = await createAuthorizedWorkOSPrincipalLinkHandler(
    cloudflare,
    workos,
    resolver,
    linker,
    { now: () => now },
  ).POST(request());

  assert.equal(response.status, 200);
  assert.equal(linkCalls, 1);
  assert.deepEqual(await response.json(), {
    linked: true,
    userId: "user:marc",
    workspaces,
  });
});

test("dual-provider link requires both independently authenticated human identities", async () => {
  let linkCalls = 0;
  const cloudflare = new InMemorySessionProvider(new Map([
    ["cf-token", session("cf", "cf-user:marc")],
  ]));
  const workos = new InMemorySessionProvider(new Map([
    ["product-bearer:workos-token", session("workos", "workos-user:user_01HBEQKA6K4QJAS93VPE39W1JT")],
  ]));
  const resolver: ApplicationUserResolver = {
    async resolve() {
      return { userId: applicationUserId("user:marc"), workspaces };
    },
  };
  const linker: ApplicationPrincipalLinker = {
    async link() {
      linkCalls += 1;
    },
  };
  const handler = createAuthorizedWorkOSPrincipalLinkHandler(
    cloudflare,
    workos,
    resolver,
    linker,
    { now: () => now },
  );

  for (const candidate of [
    request(false, true),
    request(true, false),
    new Request("https://command.example/api/auth/workos/link", {
      method: "POST",
      headers: {
        "cf-access-jwt-assertion": "bad-cf",
        cookie: "dcc-workos-access=workos-token",
      },
    }),
  ]) {
    const response = await handler.POST(candidate);
    assert.equal(response.status, 403);
  }
  assert.equal(linkCalls, 0);
});

test("dual-provider link rejects service principals and post-link user mismatches", async () => {
  const cloudflare = new InMemorySessionProvider(new Map([
    ["cf-token", session("cf", "cf-service:automation")],
  ]));
  const workos = new InMemorySessionProvider(new Map([
    ["product-bearer:workos-token", session("workos", "workos-user:user_01HBEQKA6K4QJAS93VPE39W1JT")],
  ]));
  const resolver: ApplicationUserResolver = {
    async resolve(principal) {
      return {
        userId: applicationUserId(
          principal.principalId.startsWith("workos-user:")
            ? "user:other"
            : "user:marc",
        ),
        workspaces,
      };
    },
  };
  let linkCalls = 0;
  const linker: ApplicationPrincipalLinker = {
    async link() {
      linkCalls += 1;
    },
  };

  let response = await createAuthorizedWorkOSPrincipalLinkHandler(
    cloudflare,
    workos,
    resolver,
    linker,
    { now: () => now },
  ).POST(request());
  assert.equal(response.status, 403);
  assert.equal(linkCalls, 0);

  const humanCloudflare = new InMemorySessionProvider(new Map([
    ["cf-token", session("cf", "cf-user:marc")],
  ]));
  response = await createAuthorizedWorkOSPrincipalLinkHandler(
    humanCloudflare,
    workos,
    resolver,
    linker,
    { now: () => now },
  ).POST(request());
  assert.equal(response.status, 403);
  assert.equal(linkCalls, 1);
});
