"use client"

import { useEffect, useState } from "react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/hooks/use-theme"

type AppearancePreferences = {
  fontFamily: "inter" | "roboto" | "system"
  fontSize: "small" | "medium" | "large"
}

const STORAGE_KEY = "omega-appearance-preferences"
const defaults: AppearancePreferences = { fontFamily: "inter", fontSize: "medium" }

function readPreferences(): AppearancePreferences {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return defaults
    const parsed = JSON.parse(saved) as Partial<AppearancePreferences>
    return {
      fontFamily: parsed.fontFamily === "roboto" || parsed.fontFamily === "system" ? parsed.fontFamily : "inter",
      fontSize: parsed.fontSize === "small" || parsed.fontSize === "large" ? parsed.fontSize : "medium",
    }
  } catch {
    return defaults
  }
}

function applyPreferences(preferences: AppearancePreferences) {
  const root = document.documentElement
  const fonts = {
    inter: '"Inter", system-ui, sans-serif',
    roboto: '"Roboto", Arial, sans-serif',
    system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  }
  const sizes = { small: "14px", medium: "16px", large: "18px" }
  root.style.setProperty("--font-inter", fonts[preferences.fontFamily])
  root.style.setProperty("--omega-base-font-size", sizes[preferences.fontSize])
  document.body.style.fontSize = sizes[preferences.fontSize]
}

export default function AppearanceSettings() {
  const { theme, setTheme } = useContext(ThemeProviderContext)
  const [preferences, setPreferences] = useState<AppearancePreferences>(defaults)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const loaded = readPreferences()
    setPreferences(loaded)
    applyPreferences(loaded)
  }, [])

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
      applyPreferences(preferences)
      setTheme(theme === "light" ? "light" : "dark")
      setSaved(true)
    } catch {
      setSaved(false)
    }
  }

  function cancelChanges() {
    const loaded = readPreferences()
    setPreferences(loaded)
    applyPreferences(loaded)
    setSaved(false)
  }

  return (
    <BaseLayout>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 lg:px-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">Appearance</h1>
          <p className="mt-2 text-muted-foreground">
            Personalize your Omega workspace. Changes are saved on this device and applied to the interface.
          </p>
        </header>

        <form onSubmit={onSubmit} className="flex flex-col gap-6">
          <section className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
            <h2 className="text-lg font-semibold">Color theme</h2>
            <p className="mt-1 text-sm text-muted-foreground">Choose the theme used throughout the application.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(["light", "dark"] as const).map((option) => (
                <label
                  key={option}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors ${theme === option ? "border-primary bg-accent" : "border-border hover:bg-muted"}`}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={option}
                    checked={theme === option}
                    onChange={() => { setTheme(option); setSaved(false) }}
                    className="size-4 accent-[var(--primary)]"
                  />
                  <span className="flex-1">
                    <span className="block font-medium capitalize">{option} mode</span>
                    <span className="block text-sm text-muted-foreground">
                      {option === "light" ? "Bright surfaces with dark, readable text." : "Dark surfaces with high-contrast text."}
                    </span>
                  </span>
                  <span aria-hidden="true" className={`h-10 w-10 rounded-md border ${option === "light" ? "border-gray-300 bg-white" : "border-gray-700 bg-zinc-950"}`}>
                    <span className="m-2 block h-2 rounded bg-[#34D59A]" />
                    <span className={`mx-2 block h-1.5 rounded ${option === "light" ? "bg-gray-300" : "bg-gray-600"}`} />
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
            <h2 className="text-lg font-semibold">Typography</h2>
            <p className="mt-1 text-sm text-muted-foreground">Adjust text appearance for readability.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="appearance-font-family">
                Font family
                <select
                  id="appearance-font-family"
                  value={preferences.fontFamily}
                  onChange={(event) => { setPreferences({ ...preferences, fontFamily: event.target.value as AppearancePreferences["fontFamily"] }); setSaved(false) }}
                  className="h-10 rounded-md border border-input bg-background px-3 text-foreground"
                >
                  <option value="inter">Inter</option>
                  <option value="roboto">Roboto</option>
                  <option value="system">System default</option>
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="appearance-font-size">
                Font size
                <select
                  id="appearance-font-size"
                  value={preferences.fontSize}
                  onChange={(event) => { setPreferences({ ...preferences, fontSize: event.target.value as AppearancePreferences["fontSize"] }); setSaved(false) }}
                  className="h-10 rounded-md border border-input bg-background px-3 text-foreground"
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </label>
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit">Save preferences</Button>
            <Button type="button" variant="outline" onClick={cancelChanges}>Reset saved preferences</Button>
            {saved && <p role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Preferences saved on this device.</p>}
          </div>
        </form>
      </div>
    </BaseLayout>
  )
}
