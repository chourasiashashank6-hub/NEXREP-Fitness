import { PropsWithChildren, createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import { AppTheme, type ColorSchemeName, calmTheme } from "./colors";

const defaultAppTheme: AppTheme = { ...calmTheme, colorScheme: "light" };

const ThemeContext = createContext<AppTheme>(defaultAppTheme);

export const AppThemeProvider = ({ children }: PropsWithChildren) => {
  const system = useColorScheme();
  const colorScheme: ColorSchemeName = system === "dark" ? "dark" : "light";
  const value = useMemo<AppTheme>(() => ({ ...calmTheme, colorScheme }), [colorScheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useAppTheme = () => useContext(ThemeContext);
