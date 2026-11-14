"use client"

import * as React from "react"
import { ThemeProviderContext } from "@/contexts/theme-context"

type Theme = "dark" | "light" | "system"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type SavedAppearance = {
  fontFamily?: "inter"
  fontSize?: "small" | "medium" | "large"
}

const APPEARANCE_STORAGE_KEY = "omega-appearance-preferences"

function applySavedAppearance() {
  try {
    const saved = localStorage.getItem(APPEARANCE_STORAGE_KEY)
    if (!saved) return
    const preferences = JSON.parse(saved) as SavedAppearance
    const sizes = { small: "14px", medium: "16px", large: "18px" }
    document.documentElement.style.setProperty("--font-inter", '"Inter", system-ui, sans-serif')
    if (preferences.fontSize && preferences.fontSize in sizes) {
      document.body.style.fontSize = sizes[preferences.fontSize]
    }
  } catch {
    // Ignore malformed or unavailable local preferences and keep safe defaults.
  }
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = React.useState<Theme>(() => {
    const stored = localStorage.getItem(storageKey)
    return stored === "light" || stored === "dark" || stored === "system"
      ? stored
      : defaultTheme
  })

  React.useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove("light", "dark")

    if (theme === "system") {
      const media = window.matchMedia("(prefers-color-scheme: dark)")
      const applySystemTheme = () => {
        root.classList.remove("light", "dark")
        root.classList.add(media.matches ? "dark" : "light")
      }
      applySystemTheme()
      media.addEventListener("change", applySystemTheme)
      return () => media.removeEventListener("change", applySystemTheme)
    }

    root.classList.add(theme)
  }, [theme])

  React.useEffect(() => {
    applySavedAppearance()
  }, [])

  const value = {
    theme,
    setTheme: (nextTheme: Theme) => {
      localStorage.setItem(storageKey, nextTheme)
      setTheme(nextTheme)
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}
