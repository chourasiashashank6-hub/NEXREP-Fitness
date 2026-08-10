/** Web stub — native static server is Android/iOS only. */

export const MEDIAPIPE_GUIDANCE_PAGE = "index.html";
export const MEDIAPIPE_CALIBRATION_PAGE = "calibration.html";
export const MEDIAPIPE_SERVER_RUNTIME = "web-stub";

export function acquireMediaPipeServer(_page?: string): Promise<string> {
  return Promise.reject(new Error("MediaPipe local server is not available on web."));
}

export function releaseMediaPipeServer(): void {}

export async function prepareMediaPipeServerRetry(): Promise<void> {}
