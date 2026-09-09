import i18n from "../i18n";
import { devLog } from "./devLog";

/** Map camera init/runtime errors to safe user copy. Raw detail goes to devLog only. */
export function cameraUserMessage(err: unknown, context = "camera"): string {
  devLog(`[${context}]`, err);
  return i18n.t("mediaPipe.startFailedBody");
}
