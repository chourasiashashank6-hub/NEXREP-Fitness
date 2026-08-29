import AsyncStorage from "@react-native-async-storage/async-storage";
import { DocumentDirectoryPath } from "@dr.pogodin/react-native-fs";
import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import StaticServer, {
  getActiveServer,
  getActiveServerId,
  STATES,
} from "@dr.pogodin/react-native-static-server";
import {
  MEDIAPIPE_HTML_BUILD_STAMP,
} from "./mediaPipeHtmlTemplate";
import { devLog } from "../../utils/devLog";
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
/** Bump when server lifecycle logic changes — grep Metro for this string to verify reload. */
export const MEDIAPIPE_SERVER_RUNTIME = "2026.08.07-lifecycle-v3";

const SERVER_DIR_NAME = "mediapipe-webroot";
const SERVER_ORIGIN_KEY = "nexrep_mediapipe_server_origin";

/** Absolute webroot path — must match where `writeStaticAssets()` writes files. */
const getServerWebrootPath = () => `${DocumentDirectoryPath}/${SERVER_DIR_NAME}`;

let serverInstance: StaticServer | null = null;
let originPromise: Promise<string> | null = null;
let refCount = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycle: Promise<void> = Promise.resolve();
const RELEASE_GRACE_MS = 2000;
const NATIVE_STOP_POLL_MS = 100;
const NATIVE_STOP_TIMEOUT_MS = 4000;

function writeStaticAssets(): void {
  const dir = new Directory(Paths.document, SERVER_DIR_NAME);
  dir.create({ intermediates: true, idempotent: true });

  const indexFile = new File(dir, MEDIAPIPE_GUIDANCE_PAGE);
  indexFile.create({ intermediates: true, overwrite: true });
  indexFile.write(buildStaticMediaPipeHtml());

  const calibrationFile = new File(dir, MEDIAPIPE_CALIBRATION_PAGE);
  calibrationFile.create({ intermediates: true, overwrite: true });
  calibrationFile.write(buildStaticCalibrationHtml());

  if (typeof __DEV__ !== "undefined" && __DEV__) {
    devLog(`[MediaPipe] static assets written (${MEDIAPIPE_HTML_BUILD_STAMP})`);
  }
}

function createServerInstance(port = 0): StaticServer {
  return new StaticServer({
    fileDir: getServerWebrootPath(),
    port,
    hostname: "127.0.0.1",
  });
}

function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = lifecycle.then(fn);
  lifecycle = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function parseOriginPort(origin: string): number | null {
  const match = /^https?:\/\/[^:/]+:(\d+)$/.exec(origin.trim());
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isFinite(port) && port > 0 ? port : null;
}

async function rememberServerOrigin(origin: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SERVER_ORIGIN_KEY, origin);
  } catch {
    // Non-fatal.
  }
}

async function readRememberedServerOrigin(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SERVER_ORIGIN_KEY);
  } catch {
    return null;
  }
}

async function waitForNativeServerRelease(): Promise<void> {
  const deadline = Date.now() + NATIVE_STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const activeId = await getActiveServerId();
    if (activeId == null) return;
    await new Promise((resolve) => setTimeout(resolve, NATIVE_STOP_POLL_MS));
  }
}

/**
 * Stop the native static server even when JS lost track of it (Metro reload).
 * Uses getActiveServerId() + a bridged ACTIVE Server instance per library docs.
 */
async function forceStopNativeServer(): Promise<void> {
  const tracked = serverInstance;
  serverInstance = null;
  if (tracked) {
    try {
      if (
        tracked.state === STATES.ACTIVE ||
        tracked.state === STATES.STARTING ||
        tracked.state === STATES.STOPPING
      ) {
        await tracked.stop();
      }
    } catch {
      // Continue to native bridge stop below.
    }
  }

  const foreign = getActiveServer();
  if (foreign && foreign !== tracked) {
    try {
      await foreign.stop();
    } catch {
      // Continue.
    }
  }

  const activeId = await getActiveServerId();
  if (activeId == null) return;

  if (__DEV__) {
    console.warn(`[MediaPipe] stopping orphaned native server #${activeId}`);
  }

  const rememberedOrigin = await readRememberedServerOrigin();
  const rememberedPort = rememberedOrigin ? parseOriginPort(rememberedOrigin) : null;
  const bridge = new StaticServer({
    id: activeId,
    state: STATES.ACTIVE,
    fileDir: getServerWebrootPath(),
    hostname: "127.0.0.1",
    port: rememberedPort ?? 8080,
  });

  try {
    await bridge.stop();
  } catch {
    // Best effort.
  }

  await waitForNativeServerRelease();
}

function isAnotherServerActiveError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("Another Server instance is active") ||
    message.includes("ANOTHER_INSTANCE_IS_ACTIVE")
  );
}

async function adoptActiveNativeServer(activeId: number): Promise<string | null> {
  const rememberedOrigin = await readRememberedServerOrigin();
  const rememberedPort = rememberedOrigin ? parseOriginPort(rememberedOrigin) : null;
  if (!rememberedOrigin || !rememberedPort) return null;

  serverInstance = new StaticServer({
    id: activeId,
    state: STATES.ACTIVE,
    fileDir: getServerWebrootPath(),
    hostname: "127.0.0.1",
    port: rememberedPort,
  });

  if (serverInstance.state === STATES.ACTIVE && serverInstance.origin) {
    if (__DEV__) {
      devLog(`[MediaPipe] reusing native server #${activeId} at ${serverInstance.origin}`);
    }
    return serverInstance.origin;
  }

  serverInstance = null;
  return null;
}

async function ensureServerRunning(): Promise<string> {
  writeStaticAssets();
  return runExclusive(async () => {
    const activeId = await getActiveServerId();
    if (activeId != null) {
      if (serverInstance?.id === activeId && serverInstance.state === STATES.ACTIVE) {
        return serverInstance.origin;
      }

      const adopted = await adoptActiveNativeServer(activeId);
      if (adopted) return adopted;

      await forceStopNativeServer();
    } else if (serverInstance?.state === STATES.ACTIVE) {
      return serverInstance.origin;
    } else if (serverInstance) {
      await forceStopNativeServer();
    }

    serverInstance = createServerInstance();

    try {
      const origin = await serverInstance.start();
      await rememberServerOrigin(origin);
      return origin;
    } catch (err) {
      if (!isAnotherServerActiveError(err)) throw err;
      if (__DEV__) {
        console.warn("[MediaPipe] start blocked by native server — forcing stop and retrying");
      }
      await forceStopNativeServer();
      serverInstance = createServerInstance();
      const origin = await serverInstance.start();
      await rememberServerOrigin(origin);
      return origin;
    }
  });
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
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    writeStaticAssets();
    devLog(
      `[MediaPipe] acquire (${MEDIAPIPE_SERVER_RUNTIME}, html ${MEDIAPIPE_HTML_BUILD_STAMP})`,
    );
  }
  refCount += 1;
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  if (!originPromise) {
    originPromise = ensureServerRunning().catch((err) => {
      originPromise = null;
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
    originPromise = null;
    void runExclusive(async () => {
      await forceStopNativeServer();
    });
  }, RELEASE_GRACE_MS);
}

/** Clears cached server state before a manual retry (camera error screen). */
export async function prepareMediaPipeServerRetry(): Promise<void> {
  originPromise = null;
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  await runExclusive(async () => {
    await forceStopNativeServer();
  });
}
