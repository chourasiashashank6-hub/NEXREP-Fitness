import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import hi from "./locales/hi.json";
import hinglish from "./locales/hinglish.json";

export const DEFAULT_LANGUAGE = "en";

void i18n
  .use(initReactI18next)
  .init({
    compatibilityJSON: "v4",
    fallbackLng: DEFAULT_LANGUAGE,
    resources: {
      de: {
        translation: de,
      },
      en: {
        translation: en,
      },
      es: {
        translation: es,
      },
      fr: {
        translation: fr,
      },
      hi: {
        translation: hi,
      },
      hinglish: {
        translation: hinglish,
      },
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
    returnNull: false,
  });

export default i18n;
