import { Platform } from "react-native";
import i18n from "../i18n";

export type PreparedImagePayload = {
  base64: string;
  mimeType: string;
};

/** Strip data-URI prefix and whitespace from base64 image payloads. */
export function normalizeImageBase64Payload(base64: string, mimeType?: string): PreparedImagePayload {
  let raw = (base64 || "").trim();
  let mime = (mimeType || "image/jpeg").trim().toLowerCase();

  const dataUriMatch = /^data:(image\/[\w.+-]+);base64,(.+)$/i.exec(raw);
  if (dataUriMatch) {
    mime = dataUriMatch[1].toLowerCase();
    raw = dataUriMatch[2];
  }

  raw = raw.replace(/\s/g, "");
  if (mime === "image/jpg" || mime === "image/pjpeg") {
    mime = "image/jpeg";
  }

  return { base64: raw, mimeType: mime };
}

/** On web, re-encode through canvas as JPEG so vision APIs receive a supported format. */
export async function prepareFoodImagePayload(base64: string, mimeType?: string): Promise<PreparedImagePayload> {
  const normalized = normalizeImageBase64Payload(base64, mimeType);

  if (Platform.OS !== "web" || !normalized.base64) {
    return normalized;
  }

  const dataUrl = `data:${normalized.mimeType};base64,${normalized.base64}`;

  return new Promise<PreparedImagePayload>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const maxSide = 1280;
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        const scale = Math.min(1, maxSide / Math.max(width, height, 1));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error(i18n.t("services.image.browserProcessFailed")));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const out = canvas.toDataURL("image/jpeg", 0.82);
        const comma = out.indexOf(",");
        if (comma < 0) {
          reject(new Error(i18n.t("services.image.encodeFailed")));
          return;
        }
        resolve({ base64: out.slice(comma + 1), mimeType: "image/jpeg" });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(i18n.t("services.image.processFailed")));
      }
    };
    img.onerror = () => reject(new Error(i18n.t("services.image.readFailed")));
    img.src = dataUrl;
  });
}
