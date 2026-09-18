import assert from "node:assert/strict";
import test from "node:test";
import type {
  AuthenticatedSession,
  SessionProvider,
} from "@/lib/runtime/session";
import { MigrationSessionProvider } from "@/lib/server/migration-session-provider";

function stub(name: string, calls: string[]): SessionProvider {
  return {
    async getSession(identity) {
      calls.push(`${name}:${identity}`);
      return {
        sessionId: name,
        principal: { principalId: "test-user" as never },
        expiresAt: "2099-01-01T00:00:00.000Z",
      } satisfies AuthenticatedSession;
    },
  };
}

test("migration router never cross-offers provider credentials", async () => {
  const calls: string[] = [];
  const router = new MigrationSessionProvider(
    stub("legacy", calls),
    stub("product", calls),
  );

  await router.getSession("legacy-token");
  await router.getSession("product-bearer:new-token");

  assert.deepEqual(calls, [
    "legacy:legacy-token",
    "product:product-bearer:new-token",
  ]);
});
