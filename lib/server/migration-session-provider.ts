import type {
  AuthenticatedSession,
  SessionProvider,
} from "@/lib/runtime/session";
import { readProductBearerToken } from "@/lib/server/request-session-identity";

/**
 * Transitional dual-provider router. Tagged product credentials can never be
 * offered to the legacy verifier, and legacy credentials can never be offered
 * to the product verifier.
 */
export class MigrationSessionProvider implements SessionProvider {
  constructor(
    private readonly legacy: SessionProvider,
    private readonly product: SessionProvider,
  ) {}

  getSession(
    sessionIdentity: string | null | undefined,
  ): Promise<AuthenticatedSession | null> {
    return readProductBearerToken(sessionIdentity)
      ? this.product.getSession(sessionIdentity)
      : this.legacy.getSession(sessionIdentity);
  }
}
