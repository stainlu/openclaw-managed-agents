import { describe, expect, it } from "vitest";
import { VaultCrypto } from "./vault-crypto.js";

describe("VaultCrypto", () => {
  it("round-trips a token", () => {
    const key = VaultCrypto.generateKey();
    const crypto = new VaultCrypto(key);
    const plain = "ghp_secret_token_value_42";
    const encrypted = crypto.encrypt(plain);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(encrypted).not.toContain(plain);
    expect(crypto.decrypt(encrypted)).toBe(plain);
  });

  it("produces a fresh nonce per encrypt", () => {
    const crypto = new VaultCrypto(VaultCrypto.generateKey());
    const a = crypto.encrypt("same-token");
    const b = crypto.encrypt("same-token");
    expect(a).not.toBe(b);
    expect(crypto.decrypt(a)).toBe("same-token");
    expect(crypto.decrypt(b)).toBe("same-token");
  });

  it("rejects decryption with the wrong key", () => {
    const c1 = new VaultCrypto(VaultCrypto.generateKey());
    const c2 = new VaultCrypto(VaultCrypto.generateKey());
    const encrypted = c1.encrypt("secret");
    expect(() => c2.decrypt(encrypted)).toThrow();
  });

  it("rejects tampering with the ciphertext", () => {
    const crypto = new VaultCrypto(VaultCrypto.generateKey());
    const encrypted = crypto.encrypt("secret");
    const parts = encrypted.split(":");
    // Flip one bit in the ciphertext portion — GCM auth tag rejects it.
    const ct = parts[2]!;
    const flipped = `${parts[0]}:${parts[1]}:${"A" + ct.slice(1)}`;
    expect(() => crypto.decrypt(flipped)).toThrow();
  });

  it("parseKey accepts hex, base64, and base64url 32-byte keys", () => {
    const raw = Buffer.alloc(32, 0x42);
    const hex = raw.toString("hex");
    const b64 = raw.toString("base64");
    const b64url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(VaultCrypto.parseKey(hex).equals(raw)).toBe(true);
    expect(VaultCrypto.parseKey(b64).equals(raw)).toBe(true);
    expect(VaultCrypto.parseKey(b64url).equals(raw)).toBe(true);
  });

  it("parseKey rejects wrong-length inputs", () => {
    expect(() => VaultCrypto.parseKey("abc")).toThrow();
    expect(() => VaultCrypto.parseKey("0".repeat(63))).toThrow();
    expect(() => VaultCrypto.parseKey("0".repeat(65))).toThrow();
  });

  it("isCiphertext recognizes v1: prefix only", () => {
    expect(VaultCrypto.isCiphertext("v1:nonce:cipher")).toBe(true);
    expect(VaultCrypto.isCiphertext("plaintext")).toBe(false);
    expect(VaultCrypto.isCiphertext("v2:nonce:cipher")).toBe(false);
  });
});
