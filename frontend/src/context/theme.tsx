"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Mode = "light" | "dark";

type ThemeState = {
  mode: Mode;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

const STORAGE_KEY = "assetflow.mode";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Dark by default — the mockups are a dark product.
  const [mode, setMode] = useState<Mode>("dark");

  useEffect(() => {
    // Must match the inline script in layout.tsx exactly. If these two disagree,
    // the page paints one theme and React immediately swaps it to the other.
    setMode((localStorage.getItem(STORAGE_KEY) as Mode | null) ?? "dark");
  }, []);

  useEffect(() => {
    // The `dark` class is what @custom-variant in globals.css keys off. Toggling
    // it swaps every surface token at once; the brand ramp is untouched, so an
    // organization's colour survives the light/dark switch.
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  return (
    <ThemeContext.Provider
      value={{ mode, toggle: () => setMode((m) => (m === "dark" ? "light" : "dark")) }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside <ThemeProvider>.");
  return context;
}
