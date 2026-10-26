"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"
import { BaseLayout } from "@/components/layouts/base-layout"
import { useTheme } from "@/contexts/theme-context"
import { useEffect, useState } from "react"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const appearanceFormSchema = z.object({
  theme: z.enum(["light", "dark"]),
  fontFamily: z.string().optional(),
  fontSize: z.string().optional(),
  sidebarWidth: z.string().optional(),
  contentWidth: z.string().optional(),
})

type AppearanceFormValues = z.infer<typeof appearanceFormSchema>

export default function AppearanceSettings() {
  const { theme, setTheme } = useTheme()
  const [saved, setSaved] = useState(false)
  const form = useForm<AppearanceFormValues>({
    resolver: zodResolver(appearanceFormSchema),
    defaultValues: {
      theme: theme === "system" ? (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme,
      fontFamily: "system",
      fontSize: "medium",
      sidebarWidth: "comfortable",
      contentWidth: "fluid",
    },
  })

  useEffect(() => {
    const saved = window.localStorage.getItem("omega-appearance-preferences")
    if (saved) {
      try {
        const preferences = appearanceFormSchema.parse(JSON.parse(saved))
        form.reset(preferences)
      } catch {
        window.localStorage.removeItem("omega-appearance-preferences")
      }
    }
  }, [form])

  function onSubmit(data: AppearanceFormValues) {
    window.localStorage.setItem("omega-appearance-preferences", JSON.stringify(data))
    setTheme(data.theme)
    const root = document.documentElement
    root.dataset.fontFamily = data.fontFamily || "system"
    root.dataset.fontSize = data.fontSize || "medium"
    root.dataset.sidebarWidth = data.sidebarWidth || "comfortable"
    root.dataset.contentWidth = data.contentWidth || "fluid"
    setSaved(true)
  }

  return (
    <BaseLayout>
      <div className="flex flex-col gap-6 px-4 lg:px-6">
        <div>
          <h1 className="text-3xl font-bold">Appearance</h1>
          <p className="text-muted-foreground">
            Customize the appearance of the application.
          </p>
        </div>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-6"
        >
          <FieldGroup>
            {/* Theme Section */}
            <Controller
              control={form.control}
              name="theme"
              render={({ field, fieldState }) => (
                <FieldSet data-invalid={fieldState.invalid}>
                  <FieldLegend>Theme</FieldLegend>
                  <RadioGroup
                    name={field.name}
                    value={field.value}
                    onValueChange={field.onChange}
                    className="flex gap-4"
                  >
                    <FieldLabel
                      htmlFor="appearance-theme-light"
                      className="cursor-pointer gap-0 rounded-md [&:has([data-checked])>div]:border-primary"
                    >
                      <RadioGroupItem
                        id="appearance-theme-light"
                        value="light"
                        className="sr-only absolute"
                        aria-invalid={fieldState.invalid}
                      />
                      <div className="rounded-md border-2 border-muted p-4 hover:border-accent transition-colors">
                        <div className="flex flex-col gap-2">
                          <div className="size-20 bg-white border rounded-md p-3">
                            <div className="flex flex-col gap-2">
                              <div className="h-2 bg-gray-200 rounded w-3/4"></div>
                              <div className="h-2 bg-gray-200 rounded w-1/2"></div>
                              <div className="flex gap-2">
                                <div className="size-2 bg-gray-300 rounded-full"></div>
                                <div className="h-2 bg-gray-200 rounded flex-1"></div>
                              </div>
                              <div className="flex gap-2">
                                <div className="size-2 bg-gray-300 rounded-full"></div>
                                <div className="h-2 bg-gray-200 rounded flex-1"></div>
                              </div>
                            </div>
                          </div>
                          <span className="text-sm font-medium">Light</span>
                        </div>
                      </div>
                    </FieldLabel>
                    <FieldLabel
                      htmlFor="appearance-theme-dark"
                      className="cursor-pointer gap-0 rounded-md [&:has([data-checked])>div]:border-primary"
                    >
                      <RadioGroupItem
                        id="appearance-theme-dark"
                        value="dark"
                        className="sr-only absolute"
                        aria-invalid={fieldState.invalid}
                      />
                      <div className="rounded-md border-2 border-muted p-4 hover:border-accent transition-colors">
                        <div className="flex flex-col gap-2">
                          <div className="size-20 bg-gray-900 border border-gray-700 rounded-md p-3">
                            <div className="flex flex-col gap-2">
                              <div className="h-2 bg-gray-600 rounded w-3/4"></div>
                              <div className="h-2 bg-gray-600 rounded w-1/2"></div>
                              <div className="flex gap-2">
                                <div className="size-2 bg-gray-500 rounded-full"></div>
                                <div className="h-2 bg-gray-600 rounded flex-1"></div>
                              </div>
                              <div className="flex gap-2">
                                <div className="size-2 bg-gray-500 rounded-full"></div>
                                <div className="h-2 bg-gray-600 rounded flex-1"></div>
                              </div>
                            </div>
                          </div>
                          <span className="text-sm font-medium">Dark</span>
                        </div>
                      </div>
                    </FieldLabel>
                  </RadioGroup>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </FieldSet>
              )}
            />

            <Controller
              control={form.control}
              name="fontFamily"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="appearance-font-family">
                    Font Family
                  </FieldLabel>
                  <Select
                    items={{
                      inter: "Inter",
                      roboto: "Roboto",
                      system: "System Default",
                    }}
                    name={field.name}
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <SelectTrigger
                      id="appearance-font-family"
                      aria-invalid={fieldState.invalid}
                      className="cursor-pointer"
                    >
                      <SelectValue placeholder="Select a font" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="inter">Inter</SelectItem>
                        <SelectItem value="roboto">Roboto</SelectItem>
                        <SelectItem value="system">System Default</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="fontSize"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="appearance-font-size">
                    Font Size
                  </FieldLabel>
                  <Select
                    items={{ small: "Small", medium: "Medium", large: "Large" }}
                    name={field.name}
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <SelectTrigger
                      id="appearance-font-size"
                      aria-invalid={fieldState.invalid}
                      className="cursor-pointer"
                    >
                      <SelectValue placeholder="Select font size" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="small">Small</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="large">Large</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            {/* Layout Section */}
            <Controller
              control={form.control}
              name="sidebarWidth"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="appearance-sidebar-width">
                    Sidebar Width
                  </FieldLabel>
                  <Select
                    items={{
                      compact: "Compact",
                      comfortable: "Comfortable",
                      spacious: "Spacious",
                    }}
                    name={field.name}
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <SelectTrigger
                      id="appearance-sidebar-width"
                      aria-invalid={fieldState.invalid}
                      className="cursor-pointer"
                    >
                      <SelectValue placeholder="Select sidebar width" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="compact">Compact</SelectItem>
                        <SelectItem value="comfortable">Comfortable</SelectItem>
                        <SelectItem value="spacious">Spacious</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="contentWidth"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="appearance-content-width">
                    Content Width
                  </FieldLabel>
                  <Select
                    items={{
                      fixed: "Fixed",
                      fluid: "Fluid",
                      container: "Container",
                    }}
                    name={field.name}
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <SelectTrigger
                      id="appearance-content-width"
                      aria-invalid={fieldState.invalid}
                      className="cursor-pointer"
                    >
                      <SelectValue placeholder="Select content width" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="fixed">Fixed</SelectItem>
                        <SelectItem value="fluid">Fluid</SelectItem>
                        <SelectItem value="container">Container</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </FieldGroup>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button type="submit" className="cursor-pointer">
              Save Preferences
            </Button>
            {saved && <p role="status" className="text-sm text-muted-foreground">Preferences saved and applied.</p>}
            <Button variant="outline" type="button" className="cursor-pointer" onClick={() => { form.reset(); setSaved(false) }}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </BaseLayout>
  )
}
