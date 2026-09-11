import "server-only";

import { requireLegacyWorkspace, type RequestContext } from "@/lib/runtime/context";
import type { SecretName, SecretStore, SettingsPersistence, SettingsService } from "@/lib/runtime/settings";
import type { SettingsUpdate } from "@/lib/types";
import { configuredAiApiKey, disconnectGmail, readSettings, toPublicSettings, updateSettings, writeSettings } from "@/lib/server/settings";

export class LocalSettingsPersistence implements SettingsPersistence {
  async read(context: RequestContext) {
    requireLegacyWorkspace(context);
    return readSettings();
  }

  async write(context: RequestContext, settings: Awaited<ReturnType<typeof readSettings>>) {
    requireLegacyWorkspace(context);
    await writeSettings(settings);
  }
}

export class LocalSecretStore implements SecretStore {
  async get(context: RequestContext, secret: SecretName) {
    requireLegacyWorkspace(context);
    const settings = await readSettings();
    switch (secret.kind) {
      case "ai-api-key": return configuredAiApiKey(settings, secret.provider);
      case "google-client-secret": return settings.newsletters.googleClientSecret;
      case "google-refresh-token": return settings.newsletters.refreshToken;
      case "google-access-token": return settings.newsletters.accessToken;
      case "audience-credential": return settings.audience.accounts.find(({ id }) => id === secret.accountId)?.credential || "";
    }
  }

  async set(context: RequestContext, secret: SecretName, value: string) {
    requireLegacyWorkspace(context);
    const settings = await readSettings();
    switch (secret.kind) {
      case "ai-api-key": settings.ai.apiKeys[secret.provider] = value; break;
      case "google-client-secret": settings.newsletters.googleClientSecret = value; break;
      case "google-refresh-token": settings.newsletters.refreshToken = value; break;
      case "google-access-token": settings.newsletters.accessToken = value; break;
      case "audience-credential": {
        const account = settings.audience.accounts.find(({ id }) => id === secret.accountId);
        if (!account) throw new Error("The audience account does not exist.");
        account.credential = value;
        break;
      }
    }
    await writeSettings(settings);
  }
}

export class LocalSettingsService implements SettingsService {
  async publicSettings(context: RequestContext) {
    requireLegacyWorkspace(context);
    return toPublicSettings(await readSettings());
  }

  async update(context: RequestContext, value: SettingsUpdate) {
    requireLegacyWorkspace(context);
    return updateSettings(value);
  }

  async disconnectGmail(context: RequestContext) {
    requireLegacyWorkspace(context);
    await disconnectGmail();
  }
}

export const localSettingsService = new LocalSettingsService();
