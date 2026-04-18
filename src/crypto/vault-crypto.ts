/**
 * AES-256-GCM authenticated encryption for vault credentials at rest.
 *
 * Design:
 *   - One 32-byte master key per orchestrator deployment.
 *   - 12-byte random nonce per credential write (the GCM standard).
 *   - Ciphertext encoding: `v1:<base64url(nonce)>:<base64url(cipher||tag)>`.
 *     The `v1:` prefix is the version discriminator — lets us rotate
 *     cipher or encoding later without breaking old rows.
 *   - The authenticator tag is appended to the ciphertext by Node's
 *     `cipher.getAuthTag()` and verified on decrypt. Tampering returns
 *     a decrypt error rather than garbage plaintext.
 *   - No AAD. If we ever want to bind ciphertext to credential_id or
 *     vault_id, we bump the version prefix and supply AAD there.
 *
 * Failure modes:
 *   - Decrypt with a wrong master key → throw. Don't silently return
 *     plaintext — that would let operators rotate keys and never
 *     notice that old credentials stopped working.
 *   - Malformed prefix / base64 → throw. An unreadable row is an
 *     integrity problem the operator needs to see.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const KEY_LEN = 32; // AES-256
const NONCE_LEN = 12; // GCM standard
const TAG_LEN = 16;

export class VaultCrypto {
  constructor(private readonly key: Buffer) {
    if (key.length !== KEY_LEN) {
      throw new Error(
        `vault master key must be ${KEY_LEN} bytes; got ${key.length}`,
      );
    }
  }

  /** Produce a fresh random master key. Cryptographically secure. */
  static generateKey(): Buffer {
    return randomBytes(KEY_LEN);
  }

  /**
   * Parse a user-supplied key string. Accepts:
   *   - Hex (64 chars)
   *   - Base64 / base64url (44 / 43 chars)
   * Returns the raw 32-byte buffer, or throws a descriptive error.
   */
  static parseKey(input: string): Buffer {
    const s = input.trim();
    // Hex: 64 ASCII-hex characters
    if (/^[0-9a-fA-F]{64}$/.test(s)) {
      return Buffer.from(s, "hex");
    }
    // Base64 standard (44 chars with padding) or base64url (43 unpadded).
    // Node's Buffer.from("...", "base64") accepts both with trailing `=`.
    const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    try {
      const buf = Buffer.from(padded, "base64");
      if (buf.length === KEY_LEN) return buf;
    } catch {
      /* fall through */
    }
    throw new Error(
      "OPENCLAW_VAULT_KEY must be a 32-byte key: 64 hex chars, base64 (44 chars with padding), or base64url (43 chars)",
    );
  }

  encrypt(plaintext: string): string {
    const nonce = randomBytes(NONCE_LEN);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${VERSION}:${toBase64Url(nonce)}:${toBase64Url(Buffer.concat([enc, tag]))}`;
  }

  decrypt(ciphertext: string): string {
    const parts = ciphertext.split(":");
    if (parts.length !== 3 || parts[0] !== VERSION) {
      throw new Error(`unrecognized vault ciphertext format (expected ${VERSION}:...)`);
    }
    const nonce = fromBase64Url(parts[1] as string);
    const enc = fromBase64Url(parts[2] as string);
    if (nonce.length !== NONCE_LEN) {
      throw new Error(`vault ciphertext nonce must be ${NONCE_LEN} bytes`);
    }
    if (enc.length < TAG_LEN + 1) {
      throw new Error(`vault ciphertext too short to contain auth tag`);
    }
    const ct = enc.subarray(0, enc.length - TAG_LEN);
    const tag = enc.subarray(enc.length - TAG_LEN);
    const decipher = createDecipheriv("aes-256-gcm", this.key, nonce);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
    return dec.toString("utf8");
  }

  /**
   * Detect whether a stored value is a ciphertext produced by this
   * module. Used during lazy migration: old plaintext rows pass
   * through decrypt() unchanged; new rows round-trip through
   * encrypt/decrypt.
   */
  static isCiphertext(value: string): boolean {
    return value.startsWith(`${VERSION}:`);
  }
}

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Buffer {
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}
