import type { AiKeyProvider, AudienceAccountInput, LocalAiProvider, PublicSettings, SettingsUpdate } from "@/lib/types";
import type { RequestContext } from "@/lib/runtime/context";

export type StoredAudienceAccount = Omit<AudienceAccountInput, "credentialSet" | "clearCredential"> & { credential: string };

export type StoredSettings = {
  general: { workspaceName: string };
  industry: PublicSettings["industry"];
  mentions: PublicSettings["mentions"];
  newsletters: { googleClientId: string; googleClientSecret: string; connectedEmail: string; refreshToken: string; accessToken: string; accessTokenExpiresAt: number; gmailQuery: string };
  audience: { accounts: StoredAudienceAccount[] };
  ai: { provider: PublicSettings["ai"]["provider"]; model: string; apiKeys: Record<AiKeyProvider, string>; localBaseUrls: Record<LocalAiProvider, string> };
  dailyBrief: PublicSettings["dailyBrief"];
};

export interface SettingsPersistence {
  read(context: RequestContext): Promise<StoredSettings>;
  write(context: RequestContext, settings: StoredSettings): Promise<void>;
}

export type SecretName =
  | { kind: "ai-api-key"; provider: AiKeyProvider }
  | { kind: "google-client-secret" }
  | { kind: "google-refresh-token" }
  | { kind: "google-access-token" }
  | { kind: "audience-credential"; accountId: string };

export interface SecretStore {
  get(context: RequestContext, secret: SecretName): Promise<string>;
  set(context: RequestContext, secret: SecretName, value: string): Promise<void>;
}

export interface SettingsService {
  publicSettings(context: RequestContext): Promise<PublicSettings>;
  update(context: RequestContext, value: SettingsUpdate): Promise<PublicSettings>;
  disconnectGmail(context: RequestContext): Promise<void>;
}
