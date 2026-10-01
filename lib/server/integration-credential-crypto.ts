import type { ApplicationUserId } from "@/lib/runtime/application-user";
import {
  type EncryptedIntegrationCredential,
  type IntegrationAccountId,
  type IntegrationCredentialBundle,
  type IntegrationProvider,
  validateIntegrationCredentialBundle,
} from "@/lib/runtime/integration-account";

export type IntegrationCredentialContext = Readonly<{
  userId: ApplicationUserId;
  integrationId: IntegrationAccountId;
  provider: IntegrationProvider;
}>;

export type IntegrationCredentialKeyring = Readonly<{
  activeVersion: number;
  keys: ReadonlyMap<number, string>;
}>;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Encrypted integration credential is invalid.");
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("Encrypted integration credential is invalid.");
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function aad(context: IntegrationCredentialContext): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([
    "dcc-integration-credential",
    1,
    context.userId,
    context.integrationId,
    context.provider,
  ]));
}

function keyBytes(value: string): Uint8Array {
  const bytes = fromBase64Url(value.trim());
  if (bytes.byteLength !== 32) {
    throw new Error("Integration credential key must be 32 bytes.");
  }
  return bytes;
}

async function importKey(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    keyBytes(value),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function assertKeyVersion(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error("Integration credential key version is invalid.");
  }
  return value;
}

export class AesGcmIntegrationCredentialCipher {
  constructor(private readonly keyring: IntegrationCredentialKeyring) {
    assertKeyVersion(keyring.activeVersion);
    if (!keyring.keys.has(keyring.activeVersion)) {
      throw new Error("Active integration credential key is unavailable.");
    }
  }

  async encrypt(
    context: IntegrationCredentialContext,
    bundle: IntegrationCredentialBundle,
  ): Promise<EncryptedIntegrationCredential> {
    const validated = validateIntegrationCredentialBundle(bundle);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const key = await importKey(this.keyring.keys.get(this.keyring.activeVersion)!);
    const plaintext = new TextEncoder().encode(JSON.stringify({
      version: 1,
      refreshToken: validated.refreshToken,
      accessToken: validated.accessToken ?? null,
    }));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aad(context), tagLength: 128 },
      key,
      plaintext,
    );
    return {
      algorithm: "AES-256-GCM",
      keyVersion: this.keyring.activeVersion,
      formatVersion: 1,
      nonceB64u: base64Url(nonce),
      ciphertextB64u: base64Url(new Uint8Array(encrypted)),
    };
  }

  async decrypt(
    context: IntegrationCredentialContext,
    envelope: EncryptedIntegrationCredential,
  ): Promise<IntegrationCredentialBundle> {
    if (envelope.algorithm !== "AES-256-GCM" || envelope.formatVersion !== 1) {
      throw new Error("Encrypted integration credential is invalid.");
    }
    const version = assertKeyVersion(envelope.keyVersion);
    const encodedKey = this.keyring.keys.get(version);
    if (!encodedKey) {
      throw new Error("Integration credential key version is unavailable.");
    }
    const nonce = fromBase64Url(envelope.nonceB64u);
    if (nonce.byteLength !== 12) {
      throw new Error("Encrypted integration credential is invalid.");
    }
    const key = await importKey(encodedKey);
    let decrypted: ArrayBuffer;
    try {
      decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: nonce,
          additionalData: aad(context),
          tagLength: 128,
        },
        key,
        fromBase64Url(envelope.ciphertextB64u),
      );
    } catch {
      throw new Error("Integration credential decryption failed.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(decrypted));
    } catch {
      throw new Error("Integration credential payload is invalid.");
    }
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Integration credential payload is invalid.");
    }
    const value = parsed as Record<string, unknown>;
    if (
      value.version !== 1 ||
      typeof value.refreshToken !== "string" ||
      (value.accessToken !== null && typeof value.accessToken !== "string")
    ) {
      throw new Error("Integration credential payload is invalid.");
    }
    return validateIntegrationCredentialBundle({
      refreshToken: value.refreshToken,
      accessToken: value.accessToken as string | null,
    });
  }
}

export function generateIntegrationCredentialKey(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}
