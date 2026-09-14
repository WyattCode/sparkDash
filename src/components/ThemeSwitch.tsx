import { useState, useEffect } from "react";
import { SunIcon, SunDimIcon, MoonIcon, MoonStarIcon } from "./ui/icons";

type Theme = "white" | "light" | "dark" | "oled";

const THEME_CYCLE: Theme[] = ["white", "light", "dark", "oled"];

const STORAGE_KEY = "sparkdash-theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  let stored: string | null = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* Storage unavailable. */ }
  if ((stored as Theme | null) && THEME_CYCLE.includes(stored as Theme)) return stored as Theme;
  return "dark";
}

export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* Storage unavailable. */ }
  }, [theme]);

  const toggle = () =>
    setTheme((t) => {
      const idx = THEME_CYCLE.indexOf(t);
      return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    });

  const Icon =
    theme === "white"
      ? SunIcon
      : theme === "light"
        ? SunDimIcon
        : theme === "dark"
          ? MoonIcon
          : MoonStarIcon;

  return (
    <button
      type="button"
      onClick={toggle}
      className="icon-circle"
      title={`Theme: ${theme}`}
      aria-label={`Switch theme (currently ${theme})`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
