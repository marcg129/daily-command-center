import type { ApplicationUserId } from "@/lib/runtime/application-user";

export type IntegrationAccountId = string & {
  readonly __integrationAccountId: unique symbol;
};

export type IntegrationProvider = "GOOGLE";
export type IntegrationAccountStatus =
  | "ACTIVE"
  | "REAUTH_REQUIRED"
  | "ERROR"
  | "DISCONNECTED";

export type IntegrationAccount = Readonly<{
  integrationId: IntegrationAccountId;
  userId: ApplicationUserId;
  provider: IntegrationProvider;
  providerAccountId: string;
  displayEmail: string | null;
  status: IntegrationAccountStatus;
  scopes: readonly string[];
  accessTokenExpiresAt: string | null;
  lastSuccessfulSyncAt: string | null;
  nextSyncAt: string | null;
  consecutiveFailures: number;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type IntegrationCredentialBundle = Readonly<{
  refreshToken: string;
  accessToken?: string | null;
}>;

export type EncryptedIntegrationCredential = Readonly<{
  algorithm: "AES-256-GCM";
  keyVersion: number;
  formatVersion: 1;
  nonceB64u: string;
  ciphertextB64u: string;
}>;

export function integrationAccountId(value: string): IntegrationAccountId {
  const normalized = value.trim();
  if (
    normalized.length < 8 ||
    normalized.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(normalized)
  ) {
    throw new Error("Integration account ID is invalid.");
  }
  return normalized as IntegrationAccountId;
}

export function normalizeIntegrationProvider(value: string): IntegrationProvider {
  if (value.trim().toUpperCase() !== "GOOGLE") {
    throw new Error("Integration provider is not supported.");
  }
  return "GOOGLE";
}

export function normalizeIntegrationScopes(values: readonly string[]): readonly string[] {
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  if (
    normalized.length > 100 ||
    normalized.some((value) => value.length > 500 || /[\r\n]/.test(value))
  ) {
    throw new Error("Integration scopes are invalid.");
  }
  return normalized;
}

export function validateIntegrationCredentialBundle(
  value: IntegrationCredentialBundle,
): IntegrationCredentialBundle {
  const refreshToken = value.refreshToken?.trim() ?? "";
  const accessToken = value.accessToken?.trim() || null;
  if (
    !refreshToken ||
    refreshToken.length > 16_384 ||
    /\s/.test(refreshToken) ||
    (accessToken !== null &&
      (accessToken.length > 16_384 || /\s/.test(accessToken)))
  ) {
    throw new Error("Integration credentials are invalid.");
  }
  return { refreshToken, accessToken };
}
