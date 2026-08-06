import { DocumentDirectoryPath } from "@dr.pogodin/react-native-fs";
import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import StaticServer from "@dr.pogodin/react-native-static-server";
import { buildStaticMediaPipeHtml } from "./mediaPipeHtmlTemplate";
import { buildStaticCalibrationHtml } from "./mediaPipeCalibrationTemplate";

/**
 * Local HTTP server serving MediaPipe WebView pages from a secure
 * `http://127.0.0.1:<port>/...` origin.
 *
 * HTML is written under the app document directory (`Paths.document`) and
 * served via an **absolute** `fileDir` so both platforms read the same
 * folder. Relative `fileDir` only resolves to DocumentDirectory on Android;
 * on iOS it incorrectly resolves to MainBundlePath and 404s.
 */

export const MEDIAPIPE_GUIDANCE_PAGE = "index.html";
export const MEDIAPIPE_CALIBRATION_PAGE = "calibration.html";

const SERVER_DIR_NAME = "mediapipe-webroot";

/** Absolute webroot path — must match where `writeStaticAssets()` writes files. */
const getServerWebrootPath = () => `${DocumentDirectoryPath}/${SERVER_DIR_NAME}`;

let serverInstance: StaticServer | null = null;
let originPromise: Promise<string> | null = null;
let refCount = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
const RELEASE_GRACE_MS = 2000;

function writeStaticAssets(): void {
  const dir = new Directory(Paths.document, SERVER_DIR_NAME);
  dir.create({ intermediates: true, idempotent: true });

  const indexFile = new File(dir, MEDIAPIPE_GUIDANCE_PAGE);
  indexFile.create({ intermediates: true, overwrite: true });
  indexFile.write(buildStaticMediaPipeHtml());

  const calibrationFile = new File(dir, MEDIAPIPE_CALIBRATION_PAGE);
  calibrationFile.create({ intermediates: true, overwrite: true });
  calibrationFile.write(buildStaticCalibrationHtml());
}

async function startServer(): Promise<string> {
  writeStaticAssets();
  const server = new StaticServer({
    fileDir: getServerWebrootPath(),
    port: 0,
    hostname: "127.0.0.1",
  });
  serverInstance = server;
  return server.start();
}

/**
 * Returns `http://127.0.0.1:<port>/<page>` for the given HTML asset.
 * @param page Defaults to the main guidance tracker page.
 */
export function acquireMediaPipeServer(
  page: string = MEDIAPIPE_GUIDANCE_PAGE,
): Promise<string> {
  if (Platform.OS === "web") {
    return Promise.reject(new Error("Local MediaPipe server is not used on web."));
  }
  refCount += 1;
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  if (!originPromise) {
    originPromise = startServer().catch((err) => {
      originPromise = null;
      serverInstance = null;
      throw err;
    });
  }
  return originPromise.then((origin) => `${origin}/${page}`);
}

/** Releases one reference; stops the server once nothing else holds one. */
export function releaseMediaPipeServer(): void {
  if (Platform.OS === "web") return;
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (refCount > 0) return;
    const server = serverInstance;
    serverInstance = null;
    originPromise = null;
    if (server) {
      server.stop().catch(() => {});
    }
  }, RELEASE_GRACE_MS);
}
