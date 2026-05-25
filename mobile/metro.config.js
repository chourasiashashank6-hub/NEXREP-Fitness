const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

const SKIA_WEB_STUBS = new Set(["@shopify/react-native-skia", "victory-native"]);
const zustandRoot = path.dirname(require.resolve("zustand/package.json"));

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleImport, platform) => {
  if (platform === "web" && SKIA_WEB_STUBS.has(moduleImport)) {
    return { type: "empty" };
  }

  // Zustand ESM middleware uses import.meta — breaks Expo web (classic script bundle).
  if (platform === "web" && moduleImport === "zustand") {
    return { type: "sourceFile", filePath: path.join(zustandRoot, "index.js") };
  }
  if (platform === "web" && moduleImport === "zustand/middleware") {
    return { type: "sourceFile", filePath: path.join(zustandRoot, "middleware.js") };
  }

  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleImport, platform);
  }
  return context.resolveRequest(context, moduleImport, platform);
};

module.exports = config;
