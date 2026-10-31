"use client"

import * as React from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api-client"
import { Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"

type SearchResult = { id: string; title: string; type: string; url: string; subtitle?: string }

interface CommandSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandSearch({ open, onOpenChange }: CommandSearchProps) {
  const navigate = useNavigate()
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<SearchResult[]>([])
  const [searchError, setSearchError] = React.useState("")
  const [isSearching, setIsSearching] = React.useState(false)

  React.useEffect(() => {
    const term = query.trim()
    let cancelled = false
    if (term.length < 2) {
      void Promise.resolve().then(() => {
        if (cancelled) return
        setResults([])
        setSearchError("")
        setIsSearching(false)
      })
      return () => { cancelled = true }
    }

    void Promise.resolve().then(() => {
      if (cancelled) return
      setIsSearching(true)
      setSearchError("")
    })
    const timeout = window.setTimeout(async () => {
      try {
        const found = await api.get<SearchResult[]>(`/search?q=${encodeURIComponent(term)}`)
        if (!cancelled) setResults(Array.isArray(found) ? found : [])
      } catch (error) {
        if (!cancelled) {
          setResults([])
          setSearchError(error instanceof Error ? error.message : (error as { message?: string })?.message ?? "Search is unavailable.")
        }
      } finally {
        if (!cancelled) setIsSearching(false)
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [query])

  React.useEffect(() => {
    let cancelled = false
    if (!open) {
      void Promise.resolve().then(() => {
        if (cancelled) return
        setQuery("")
        setResults([])
        setSearchError("")
        setIsSearching(false)
      })
    }
    return () => { cancelled = true }
  }, [open])

  const handleSelect = (url: string) => {
    navigate(url)
    setQuery("")
    setResults([])
    onOpenChange(false)
  }

  const term = query.trim()

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search Omega Solutions"
      description="Search company records you have permission to access"
      className="sm:max-w-[640px]"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search customers, products, invoices…"
          autoFocus
          value={query}
          onValueChange={setQuery}
        />
        <CommandList className="max-h-[400px]">
          {term.length < 2 ? (
            <CommandEmpty>Type at least 2 characters to search company records.</CommandEmpty>
          ) : isSearching ? (
            <CommandEmpty>Searching company records…</CommandEmpty>
          ) : searchError ? (
            <CommandEmpty>{searchError}</CommandEmpty>
          ) : results.length === 0 ? (
            <CommandEmpty>No matching company records found.</CommandEmpty>
          ) : null}
          {results.length > 0 && !searchError && (
            <CommandGroup heading="Company records">
              {results.map((item) => (
                <CommandItem
                  key={`${item.type}:${item.id}`}
                  value={`${item.type} ${item.title} ${item.subtitle ?? ""}`}
                  onSelect={() => handleSelect(item.url)}
                >
                  <Search className="mr-2 size-4 shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{item.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {item.type}{item.subtitle ? ` · ${item.subtitle}` : ""}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

export function SearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className="relative w-full justify-start font-normal text-muted-foreground sm:pr-12 md:w-36 lg:w-56"
    >
      <Search data-icon="inline-start" />
      Search...
      <Kbd className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 sm:inline-flex">
        ⌘K
      </Kbd>
    </Button>
  )
}
