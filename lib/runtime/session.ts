export type PrincipalId = string & { readonly __principalId: unique symbol };

export type AuthenticatedPrincipal = Readonly<{ principalId: PrincipalId }>;
export type AuthenticatedSession = Readonly<{
  sessionId: string;
  principal: AuthenticatedPrincipal;
  expiresAt: string;
}>;

export interface SessionProvider {
  getSession(sessionIdentity: string | null | undefined): Promise<AuthenticatedSession | null>;
}

export function principalId(value: string): PrincipalId {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{2,127}$/.test(normalized))
    throw new Error("A stable principal ID is required.");
  return normalized as PrincipalId;
}

export function requireAuthenticatedSession(
  session: AuthenticatedSession | null,
  now = new Date(),
): AuthenticatedPrincipal {
  if (!session?.sessionId || !session.principal?.principalId)
    throw new Error("Authentication required.");
  if (!Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= now.getTime())
    throw new Error("Authentication required.");
  return session.principal;
}

/** Contract-test provider only. It does not inspect or trust request headers. */
export class InMemorySessionProvider implements SessionProvider {
  constructor(private readonly sessions: ReadonlyMap<string, AuthenticatedSession>) {}
  async getSession(sessionIdentity: string | null | undefined) {
    if (!sessionIdentity) return null;
    return this.sessions.get(sessionIdentity) ?? null;
  }
}
