import type { ApplicationUserId } from "@/lib/runtime/application-user";
import type { D1Database } from "@/lib/runtime/d1";
import type { PrincipalId } from "@/lib/runtime/session";

type PrincipalMappingRow = Readonly<{
  user_id: string;
  provider: string;
}>;

type TargetBoundaryRow = Readonly<{
  user_id: string;
  status: string;
  workspace_id: string | null;
  workspace_key: string | null;
  role: string | null;
}>;

export class ApplicationPrincipalLinkError extends Error {
  constructor() {
    super("Application principal linking denied.");
    this.name = "ApplicationPrincipalLinkError";
  }
}

function normalizeProvider(value: string): string {
  const provider = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_.:-]{0,63}$/.test(provider)) {
    throw new ApplicationPrincipalLinkError();
  }
  return provider;
}

/**
 * Attaches an independently verified authentication principal to an existing
 * durable DCC user. This class never creates users, workspaces, or memberships.
 */
export class D1ApplicationPrincipalLinker {
  constructor(private readonly database: D1Database) {}

  private async validateTargetUser(userId: string): Promise<void> {
    const result = await this.database.prepare(
      `SELECT u.user_id, u.status,
              m.workspace_id, m.workspace_key, m.role
       FROM users u
       LEFT JOIN workspace_memberships m ON m.user_id = u.user_id
       WHERE u.user_id = ?
       ORDER BY m.workspace_key, m.workspace_id`,
    ).bind(userId).all<TargetBoundaryRow>();

    if (!result.success) throw new Error("Application user link lookup failed.");
    const rows = result.results ?? [];
    if (
      rows.length === 0 ||
      rows.some((row) => row.user_id !== userId || row.status !== "ACTIVE")
    ) {
      throw new ApplicationPrincipalLinkError();
    }

    const personal = rows.filter((row) => row.workspace_key === "personal");
    if (
      personal.length !== 1 ||
      !personal[0].workspace_id ||
      personal[0].role !== "OWNER"
    ) {
      throw new ApplicationPrincipalLinkError();
    }
  }

  private async mapping(principal: string): Promise<PrincipalMappingRow | null> {
    const result = await this.database.prepare(
      `SELECT user_id, provider
       FROM user_principals
       WHERE principal_id = ?`,
    ).bind(principal).all<PrincipalMappingRow>();

    if (!result.success) throw new Error("Application principal link lookup failed.");
    const rows = result.results ?? [];
    if (rows.length === 0) return null;
    if (rows.length !== 1) throw new ApplicationPrincipalLinkError();
    return rows[0];
  }

  async link(input: Readonly<{
    userId: ApplicationUserId;
    principalId: PrincipalId;
    provider: string;
  }>): Promise<void> {
    const userId = input.userId.trim();
    const principal = input.principalId.trim();
    const provider = normalizeProvider(input.provider);

    if (!userId || !principal) throw new ApplicationPrincipalLinkError();
    await this.validateTargetUser(userId);

    const existing = await this.mapping(principal);
    if (existing) {
      if (
        existing.user_id === userId &&
        existing.provider.toUpperCase() === provider
      ) {
        return;
      }
      throw new ApplicationPrincipalLinkError();
    }

    try {
      const result = await this.database.prepare(
        `INSERT INTO user_principals
           (principal_id, user_id, provider, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      ).bind(principal, userId, provider).run();
      if (!result.success) throw new Error("Application principal link write failed.");
    } catch (error) {
      const raced = await this.mapping(principal);
      if (
        raced &&
        raced.user_id === userId &&
        raced.provider.toUpperCase() === provider
      ) {
        return;
      }
      if (error instanceof ApplicationPrincipalLinkError) throw error;
      throw new ApplicationPrincipalLinkError();
    }

    const linked = await this.mapping(principal);
    if (
      !linked ||
      linked.user_id !== userId ||
      linked.provider.toUpperCase() !== provider
    ) {
      throw new ApplicationPrincipalLinkError();
    }
  }
}
