export const WELLBEING_TAG = "wellbeing";
export const COUNSELLOR_NOTE_TAG = "counsellor-notes";
const DEMO_KEY_MATERIAL = new TextEncoder().encode("KADS-DEMO-ONLY-NOT-FOR-REAL-DATA");

async function getDemoKey(): Promise<CryptoKey> {
  const keyBytes = await crypto.subtle.digest("SHA-256", DEMO_KEY_MATERIAL);
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function demoEncrypt(data: string | Uint8Array, tag: string): Promise<string> {
  const plaintext = toArrayBuffer(typeof data === "string" ? new TextEncoder().encode(data) : data);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(new TextEncoder().encode(tag)) },
    await getDemoKey(),
    plaintext,
  );
  return `kads-demo:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export async function demoDecrypt(encrypted: string | Uint8Array, tag: string): Promise<string | Uint8Array> {
  if (typeof encrypted !== "string" || !encrypted.startsWith("kads-demo:")) {
    throw new Error("This item is not encrypted with the KADS demo key.");
  }
  const [, iv, ciphertext] = encrypted.split(":");
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(base64ToBytes(iv)),
      additionalData: toArrayBuffer(new TextEncoder().encode(tag)),
    },
    await getDemoKey(),
    toArrayBuffer(base64ToBytes(ciphertext)),
  );
  return new TextDecoder().decode(plaintext);
}

type StoredCiphertext =
  | { encoding: "text"; value: string }
  | { encoding: "base64"; value: string };

export function encodeCiphertext(value: string | Uint8Array): string {
  const payload: StoredCiphertext = typeof value === "string"
    ? { encoding: "text", value }
    : { encoding: "base64", value: bytesToBase64(value) };
  return JSON.stringify(payload);
}

export function decodeCiphertext(serialized: string): string | Uint8Array {
  const payload = JSON.parse(serialized) as StoredCiphertext;
  if (payload.encoding === "text") return payload.value;
  if (payload.encoding === "base64") return base64ToBytes(payload.value);
  throw new Error("Stored encrypted note has an unsupported format.");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
