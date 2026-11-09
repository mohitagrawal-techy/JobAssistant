import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

export type Theme = "playful" | "professional";

export const THEMES: { id: Theme; label: string }[] = [
  { id: "playful", label: "Playful" },
  { id: "professional", label: "Professional" },
];

const STORAGE_KEY = "jobassistent-theme";

function savedTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "professional" ? "professional" : "playful";
  } catch {
    return "playful";
  }
}

const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void }>({
  theme: "playful",
  setTheme: () => undefined,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(savedTheme);
  const value = useMemo(
    () => ({
      theme,
      setTheme: (next: Theme) => {
        setThemeState(next);
        if (next === "professional") document.documentElement.dataset.theme = next;
        else delete document.documentElement.dataset.theme;
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // The theme still applies for this visit when storage is blocked.
        }
      },
    }),
    [theme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
