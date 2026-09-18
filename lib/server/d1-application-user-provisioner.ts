import {
  ApplicationUserAccessError,
  type ApplicationUserResolver,
  type ResolvedApplicationUser,
} from "@/lib/runtime/application-user";
import type { D1Database, D1PreparedStatement } from "@/lib/runtime/d1";
import type { AuthenticatedPrincipal, PrincipalId } from "@/lib/runtime/session";

export type ProvisionedIdentityIds = Readonly<{
  userId: string;
  personalWorkspaceId: string;
}>;

export type ProvisioningIdFactory = (
  principalId: string,
  provider: string,
) => ProvisionedIdentityIds | Promise<ProvisionedIdentityIds>;

export type ProvisioningIdentity = Readonly<{
  principalId: PrincipalId;
  provider: string;
}>;

type IdentityRow = Readonly<{
  user_id: string;
  status: string;
  provider: string;
  workspace_id: string | null;
  workspace_key: string | null;
  role: string | null;
}>;

export class ApplicationUserProvisioningError extends ApplicationUserAccessError {
  constructor() {
    super();
    this.name = "ApplicationUserProvisioningError";
    this.message = "Application user provisioning denied.";
  }
}

function normalizeProvider(value: string): string {
  const provider = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_.:-]{0,63}$/.test(provider)) {
    throw new ApplicationUserProvisioningError();
  }
  return provider;
}

function validProvisionedId(value: string, prefix: "user:" | "personal:"): string {
  const normalized = value.trim();
  if (
    !normalized.startsWith(prefix) ||
    normalized.length < prefix.length + 8 ||
    normalized.length > 160 ||
    !/^[A-Za-z0-9:_-]+$/.test(normalized)
  ) {
    throw new ApplicationUserProvisioningError();
  }
  return normalized;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function defaultIdFactory(principal: string, provider: string): Promise<ProvisionedIdentityIds> {
  const digest = await sha256Hex(`dcc-user-v1\0${provider}\0${principal}`);
  const opaque = digest.slice(0, 32);
  return {
    userId: `user:${opaque}`,
    personalWorkspaceId: `personal:${opaque}`,
  };
}

function verifyExisting(rows: readonly IdentityRow[], provider: string): "missing" | "ready" {
  if (rows.length === 0) return "missing";

  const userIds = new Set(rows.map((row) => row.user_id));
  const providers = new Set(rows.map((row) => row.provider.toUpperCase()));
  if (
    userIds.size !== 1 ||
    providers.size !== 1 ||
    !providers.has(provider) ||
    rows.some((row) => row.status !== "ACTIVE")
  ) {
    throw new ApplicationUserProvisioningError();
  }

  const personal = rows.filter((row) => row.workspace_key === "personal");
  if (
    personal.length !== 1 ||
    !personal[0].workspace_id ||
    personal[0].role !== "OWNER"
  ) {
    throw new ApplicationUserProvisioningError();
  }
  return "ready";
}

export class D1ApplicationUserProvisioner {
  constructor(
    private readonly database: D1Database,
    private readonly idFactory: ProvisioningIdFactory = defaultIdFactory,
  ) {}

  private async identityRows(principal: string): Promise<IdentityRow[]> {
    const result = await this.database.prepare(
      `SELECT u.user_id, u.status, p.provider,
              m.workspace_id, m.workspace_key, m.role
       FROM user_principals p
       JOIN users u ON u.user_id = p.user_id
       LEFT JOIN workspace_memberships m ON m.user_id = u.user_id
       WHERE p.principal_id = ?
       ORDER BY m.workspace_key, m.workspace_id`,
    ).bind(principal).all<IdentityRow>();

    if (!result.success) throw new Error("Application user provisioning lookup failed.");
    return result.results ?? [];
  }

  async provision(identity: ProvisioningIdentity): Promise<void> {
    const principal = identity.principalId.trim();
    const provider = normalizeProvider(identity.provider);
    if (!principal) throw new ApplicationUserProvisioningError();

    if (verifyExisting(await this.identityRows(principal), provider) === "ready") return;

    const generated = await this.idFactory(principal, provider);
    const userId = validProvisionedId(generated.userId, "user:");
    const workspaceId = validProvisionedId(generated.personalWorkspaceId, "personal:");
    if (userId === workspaceId) throw new ApplicationUserProvisioningError();

    const statements: D1PreparedStatement[] = [
      this.database.prepare(
        `INSERT INTO users (user_id, status, created_at, updated_at)
         VALUES (?, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ).bind(userId),
      this.database.prepare(
        `INSERT INTO workspaces
           (workspace_id, name, workspace_type, theme_key, created_at, updated_at)
         VALUES (?, 'Personal', 'PERSONAL', 'personal-tech-blue', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ).bind(workspaceId),
      this.database.prepare(
        `INSERT INTO user_principals (principal_id, user_id, provider, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      ).bind(principal, userId, provider),
      this.database.prepare(
        `INSERT INTO workspace_memberships
           (user_id, workspace_id, workspace_key, role, created_at, updated_at)
         VALUES (?, ?, 'personal', 'OWNER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ).bind(userId, workspaceId),
    ];

    try {
      const results = await this.database.batch(statements);
      if (results.length !== statements.length || results.some((result) => !result.success)) {
        throw new Error("D1 provisioning batch failed.");
      }
    } catch (error) {
      // A concurrent first request for the same identity may have completed the
      // deterministic provisioning batch first. Accept only the exact safe
      // resulting state; otherwise preserve the original failure boundary.
      try {
        if (verifyExisting(await this.identityRows(principal), provider) === "ready") return;
      } catch {
        throw new ApplicationUserProvisioningError();
      }
      throw error;
    }

    if (verifyExisting(await this.identityRows(principal), provider) !== "ready") {
      throw new ApplicationUserProvisioningError();
    }
  }
}

export class AutoProvisioningApplicationUserResolver implements ApplicationUserResolver {
  constructor(
    private readonly resolver: ApplicationUserResolver,
    private readonly provisioner: D1ApplicationUserProvisioner,
    private readonly provider: string,
    private readonly allowPrincipal: (principal: AuthenticatedPrincipal) => boolean = () => true,
  ) {}

  async resolve(principal: AuthenticatedPrincipal): Promise<ResolvedApplicationUser> {
    let resolved: ResolvedApplicationUser;
    try {
      resolved = await this.resolver.resolve(principal);
    } catch (error) {
      if (!(error instanceof ApplicationUserAccessError)) throw error;
      if (!this.allowPrincipal(principal)) throw error;

      await this.provisioner.provision({
        principalId: principal.principalId,
        provider: this.provider,
      });
      return this.resolver.resolve(principal);
    }

    // A resolver success only proves the principal has at least one authorized
    // membership. Existing identities must still satisfy the stronger private
    // Personal OWNER boundary before a hosted session is returned.
    await this.provisioner.provision({
      principalId: principal.principalId,
      provider: this.provider,
    });
    return resolved;
  }
}
