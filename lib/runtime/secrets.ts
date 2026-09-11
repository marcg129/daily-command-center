import type { ProductWorkspaceId, RequestContext } from "@/lib/runtime/context";
import type { AuthenticatedPrincipal, PrincipalId } from "@/lib/runtime/session";
import type { WorkspaceResolver } from "@/lib/runtime/workspace-resolver";

export type ApplicationId = string & { readonly __applicationId: unique symbol };
export type SecretId = string & { readonly __secretId: unique symbol };
export type SecretName = string & { readonly __secretName: unique symbol };

export type SecretOwner =
  | Readonly<{ type: "APPLICATION"; applicationId: ApplicationId }>
  | Readonly<{ type: "USER"; principalId: PrincipalId }>
  | Readonly<{ type: "WORKSPACE"; workspaceId: ProductWorkspaceId }>;

export type SecretIdentity = Readonly<{ id: SecretId; owner: SecretOwner; name: SecretName }>;
export type SecretMetadata = SecretIdentity & Readonly<{
  providerReference: string;
  createdAt: string;
  updatedAt: string;
}>;

export interface SecretProvider {
  get(secret: SecretIdentity): Promise<string | null>;
  set(secret: SecretIdentity, plaintextValue: string): Promise<void>;
  delete(secret: SecretIdentity): Promise<void>;
}

export const applicationId = (value: string) => typedId<ApplicationId>(value, "application");
export const secretId = (value: string) => typedId<SecretId>(value, "secret");
export const secretName = (value: string) => typedId<SecretName>(value, "secret name");
function typedId<T extends string>(value: string, label: string): T {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_.-]{1,127}$/.test(normalized)) throw new Error(`Invalid ${label} identifier.`);
  return normalized as T;
}

/** Fake protected provider. Values live only in process memory and metadata never contains them. */
export class InMemorySecretProvider implements SecretProvider {
  readonly metadata = new Map<string, SecretMetadata>();
  private readonly values = new Map<string, string>();
  private key(secret: SecretIdentity) { return `${ownerKey(secret.owner)}:${secret.name}:${secret.id}`; }
  async get(secret: SecretIdentity) { return this.values.get(this.key(secret)) ?? null; }
  async set(secret: SecretIdentity, plaintextValue: string) {
    const key = this.key(secret); const now = new Date().toISOString(); const prior = this.metadata.get(key);
    this.values.set(key, plaintextValue);
    this.metadata.set(key, { ...secret, providerReference: `memory://${secret.id}`, createdAt: prior?.createdAt ?? now, updatedAt: now });
  }
  async delete(secret: SecretIdentity) { const key = this.key(secret); this.values.delete(key); this.metadata.delete(key); }
}

function ownerKey(owner: SecretOwner) {
  if (owner.type === "APPLICATION") return `application:${owner.applicationId}`;
  if (owner.type === "USER") return `user:${owner.principalId}`;
  return `workspace:${owner.workspaceId}`;
}

export type SecretAccess = Readonly<{
  principal: AuthenticatedPrincipal;
  context: RequestContext;
  applicationService?: ApplicationId;
}>;

export class SecretAuthorizationService {
  constructor(
    private readonly provider: SecretProvider,
    private readonly workspaceResolver: WorkspaceResolver,
  ) {}
  private async authorize(access: SecretAccess, owner: SecretOwner) {
    if (owner.type === "APPLICATION") {
      if (access.applicationService !== owner.applicationId) throw new Error("Application secret access denied.");
    } else if (owner.type === "USER") {
      if (access.principal.principalId !== owner.principalId) throw new Error("User secret access denied.");
    } else {
      if (access.context.workspaceId !== owner.workspaceId) throw new Error("Workspace secret access denied.");
      const authorizedContext = await this.workspaceResolver.resolve(access.principal, owner.workspaceId);
      if (authorizedContext.workspaceId !== owner.workspaceId || authorizedContext.workspaceId !== access.context.workspaceId)
        throw new Error("Workspace secret access denied.");
    }
  }
  async get(access: SecretAccess, secret: SecretIdentity) { await this.authorize(access, secret.owner); return this.provider.get(secret); }
  async set(access: SecretAccess, secret: SecretIdentity, plaintext: string) { await this.authorize(access, secret.owner); await this.provider.set(secret, plaintext); }
  async delete(access: SecretAccess, secret: SecretIdentity) { await this.authorize(access, secret.owner); await this.provider.delete(secret); }
}
