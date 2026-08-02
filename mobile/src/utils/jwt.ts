/**
 * Decode JWT `sub` without verifying the signature (storage keys only).
 * Includes a small base64 polyfill when `atob` is unavailable (some RN runtimes).
 */
function decodeBase64Polyfill(b64: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const map: Record<string, number> = {};
  for (let i = 0; i < alphabet.length; i++) map[alphabet[i]] = i;

  let bits = 0;
  let bitLen = 0;
  let out = "";
  for (let i = 0; i < b64.length; i++) {
    const c = b64[i];
    if (c === "=") break;
    const v = map[c];
    if (v === undefined) continue;
    bits = (bits << 6) | v;
    bitLen += 6;
    if (bitLen >= 8) {
      bitLen -= 8;
      out += String.fromCharCode((bits >> bitLen) & 0xff);
    }
  }
  return out;
}

function base64UrlToString(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + "=".repeat(padLen);
  if (typeof globalThis.atob === "function") {
    return globalThis.atob(padded);
  }
  return decodeBase64Polyfill(padded);
}

export function decodeJwtSub(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const json = base64UrlToString(parts[1]);
    const parsed = JSON.parse(json) as { sub?: unknown };
    const sub = parsed.sub;
    if (typeof sub === "string") return sub;
    if (typeof sub === "number") return String(sub);
    return null;
  } catch {
    return null;
  }
}
