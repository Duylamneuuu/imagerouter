import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const KEY_BYTES = 32;
const IV_BYTES = 12;

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch {}
}

export class CredentialVault {
  constructor({ dataDirectory, key } = {}) {
    this.dataDirectory = dataDirectory;
    this.key = key ? Buffer.from(key) : this.#loadOrCreateKey();
    if (this.key.length !== KEY_BYTES) throw new Error("Credential vault key must be 32 bytes");
  }

  #loadOrCreateKey() {
    ensurePrivateDirectory(this.dataDirectory);
    const keyPath = path.join(this.dataDirectory, "credential.key");
    if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath);
    const key = crypto.randomBytes(KEY_BYTES);
    fs.writeFileSync(keyPath, key, { flag: "wx", mode: 0o600 });
    try { fs.chmodSync(keyPath, 0o600); } catch {}
    return key;
  }

  encrypt(value) {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(value ?? {}), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
  }

  decrypt(payload) {
    const [version, ivPart, tagPart, dataPart] = String(payload || "").split(":");
    if (version !== "v1" || !ivPart || !tagPart || !dataPart) {
      throw new Error("Unsupported credential payload");
    }
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8"));
  }
}
