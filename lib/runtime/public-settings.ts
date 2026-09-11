import type { AiKeyProvider, PublicSettings } from "@/lib/types";
import type { StoredSettings } from "@/lib/runtime/settings";
import { DEFAULT_LOCAL_AI_URLS } from "@/lib/ai-providers";
import { isValidPublicProfileUrl } from "@/lib/public-metrics";

export function publicSettingsFromStored(
  settings: StoredSettings,
  environmentKey: (provider: AiKeyProvider) => string,
): PublicSettings {
  const configuredKey = (provider: AiKeyProvider) => settings.ai.apiKeys[provider]?.trim() || environmentKey(provider);
  const keySource = (provider: AiKeyProvider) => settings.ai.apiKeys[provider]?.trim()
    ? "settings" as const
    : environmentKey(provider) ? "environment" as const : "none" as const;
  return {
    general: settings.general,
    industry: settings.industry,
    mentions: settings.mentions,
    newsletters: {
      googleClientId: settings.newsletters.googleClientId,
      googleClientSecretSet: Boolean(settings.newsletters.googleClientSecret),
      connected: Boolean(settings.newsletters.refreshToken && settings.newsletters.connectedEmail),
      connectedEmail: settings.newsletters.connectedEmail,
      gmailQuery: settings.newsletters.gmailQuery,
    },
    audience: {
      accounts: settings.audience.accounts.map(({ credential, ...account }) => ({
        ...account,
        profileUrl: account.profileUrl && isValidPublicProfileUrl(account.platform, account.profileUrl) ? account.profileUrl : "",
        credentialSet: Boolean(credential),
      })),
    },
    ai: {
      provider: settings.ai.provider,
      model: settings.ai.model,
      localBaseUrls: { ...DEFAULT_LOCAL_AI_URLS, ...settings.ai.localBaseUrls },
      keySet: {
        openai: Boolean(configuredKey("openai")), anthropic: Boolean(configuredKey("anthropic")),
        gemini: Boolean(configuredKey("gemini")), xai: Boolean(configuredKey("xai")),
        lmstudio: Boolean(configuredKey("lmstudio")), ollama: Boolean(configuredKey("ollama")),
      },
      keySource: {
        openai: keySource("openai"), anthropic: keySource("anthropic"), gemini: keySource("gemini"),
        xai: keySource("xai"), lmstudio: keySource("lmstudio"), ollama: keySource("ollama"),
      },
    },
    dailyBrief: settings.dailyBrief,
  };
}
