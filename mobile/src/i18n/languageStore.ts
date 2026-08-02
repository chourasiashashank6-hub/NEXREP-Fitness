import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import { create } from "zustand";

import { updatePreferredLanguage } from "../api/user";
import i18n, { DEFAULT_LANGUAGE } from "./index";

const LANGUAGE_STORAGE_KEY = "@fitness:i18n:explicit_language";

type LanguageState = {
  language: string;
  deviceLanguage: string;
  explicitLanguage: string | null;
  hydrated: boolean;
  syncing: boolean;
  syncPending: boolean;
  bootstrap: () => Promise<void>;
  setLanguage: (language: string, options?: { sync?: boolean }) => Promise<void>;
  applyServerLanguage: (language: string | null | undefined) => Promise<void>;
  syncExplicitLanguage: () => Promise<void>;
};

const normalizeLanguageTag = (language: string | null | undefined) => {
  const raw = String(language ?? "").trim();
  if (!raw) return DEFAULT_LANGUAGE;
  const [primary, ...rest] = raw.replace(/_/g, "-").split("-");
  return [primary.toLowerCase(), ...rest.map((part) => part.toUpperCase())].join("-");
};

const getDeviceLanguage = () => {
  const locale = Localization.getLocales()[0];
  return normalizeLanguageTag(locale?.languageTag ?? locale?.languageCode);
};

const applyLanguage = async (language: string) => {
  if (i18n.language !== language) {
    await i18n.changeLanguage(language);
  }
};

export const useLanguageStore = create<LanguageState>((set, get) => ({
  language: DEFAULT_LANGUAGE,
  deviceLanguage: DEFAULT_LANGUAGE,
  explicitLanguage: null,
  hydrated: false,
  syncing: false,
  syncPending: false,
  bootstrap: async () => {
    const deviceLanguage = getDeviceLanguage();
    let explicitLanguage: string | null = null;
    try {
      explicitLanguage = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch {
      explicitLanguage = null;
    }

    const language = normalizeLanguageTag(explicitLanguage || deviceLanguage);
    await applyLanguage(language);
    set({
      language,
      deviceLanguage,
      explicitLanguage: explicitLanguage ? normalizeLanguageTag(explicitLanguage) : null,
      syncPending: Boolean(explicitLanguage),
      hydrated: true,
    });
  },
  setLanguage: async (nextLanguage, options) => {
    const language = normalizeLanguageTag(nextLanguage);
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    await applyLanguage(language);
    set({ language, explicitLanguage: language, hydrated: true, syncPending: true });
    if (options?.sync !== false) {
      void get().syncExplicitLanguage();
    }
  },
  applyServerLanguage: async (serverLanguage) => {
    const language = normalizeLanguageTag(serverLanguage);
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    await applyLanguage(language);
    set({ language, explicitLanguage: language, hydrated: true, syncPending: false });
  },
  syncExplicitLanguage: async () => {
    const { explicitLanguage, syncing, syncPending } = get();
    if (!explicitLanguage || syncing || !syncPending) return;
    set({ syncing: true });
    try {
      await updatePreferredLanguage(explicitLanguage);
      set({ syncPending: false });
    } catch {
      // Preference stays local; the next authenticated app session can retry.
    } finally {
      set({ syncing: false });
    }
  },
}));
