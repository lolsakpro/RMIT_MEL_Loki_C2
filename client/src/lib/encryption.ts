export const WELLBEING_TAG = "wellbeing";

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
