"use client"

import { useState, useCallback, useEffect } from "react"
import { type CalendarEvent } from "./types"
import { api } from "@/lib/api-client"

type ApiEvent = {
  id: string
  title: string
  description?: string | null
  event_type: CalendarEvent["type"]
  start_at: string
  end_at?: string | null
  location?: string | null
  all_day?: boolean
}

function fromApi(event: ApiEvent): CalendarEvent {
  const date = new Date(event.start_at)
  return {
    id: event.id,
    title: event.title,
    date,
    time: date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    duration: event.end_at ? "Scheduled" : "—",
    type: event.event_type,
    attendees: [],
    location: event.location ?? "",
    color: ({ meeting: "bg-blue-500", event: "bg-green-500", personal: "bg-pink-500", task: "bg-orange-500", reminder: "bg-purple-500" } as Record<string,string>)[event.event_type] ?? "bg-blue-500",
    description: event.description ?? undefined,
  }
}

export interface UseCalendarState {
  selectedDate: Date
  showEventForm: boolean
  editingEvent: CalendarEvent | null
  showCalendarSheet: boolean
  events: CalendarEvent[]
}
export interface UseCalendarActions {
  setSelectedDate: (date: Date) => void
  setShowEventForm: (show: boolean) => void
  setEditingEvent: (event: CalendarEvent | null) => void
  setShowCalendarSheet: (show: boolean) => void
  handleDateSelect: (date: Date) => void
  handleNewEvent: () => void
  handleNewCalendar: () => void
  handleSaveEvent: (eventData: Partial<CalendarEvent>) => void
  handleDeleteEvent: (eventId: string | number) => void
  handleEditEvent: (event: CalendarEvent) => void
}
export interface UseCalendarReturn extends UseCalendarState, UseCalendarActions {}

export function useCalendar(_initialEvents: CalendarEvent[] = []): UseCalendarReturn {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [showEventForm, setShowEventForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [showCalendarSheet, setShowCalendarSheet] = useState(false)
  const [events, setEvents] = useState<CalendarEvent[]>([])

  const reloadEvents = useCallback(async () => {
    const rows = await api.get<ApiEvent[]>("/projects/events")
    setEvents(rows.map(fromApi))
  }, [])

  useEffect(() => {
    void reloadEvents().catch(() => setEvents([]))
  }, [reloadEvents])

  const handleDateSelect = useCallback((date: Date) => {
    setSelectedDate(date)
    setShowCalendarSheet(false)
  }, [])
  const handleNewEvent = useCallback(() => {
    setEditingEvent(null)
    setShowEventForm(true)
  }, [])
  const handleNewCalendar = useCallback(() => {}, [])
  const handleSaveEvent = useCallback((eventData: Partial<CalendarEvent>) => {
    void (async () => {
      try {
        const date = eventData.date ?? new Date()
        const [timePart, meridiem] = (eventData.time ?? "9:00 AM").split(" ")
        const [hourText, minuteText = "00"] = timePart.split(":")
        let hour = Number(hourText) % 12
        if (meridiem?.toUpperCase() === "PM") hour += 12
        date.setHours(hour, Number(minuteText), 0, 0)
        const payload = {
          title: eventData.title?.trim() || "Untitled event",
          description: eventData.description,
          eventType: eventData.type ?? "meeting",
          startAt: date.toISOString(),
          location: eventData.location,
        }
        if (eventData.id) await api.patch(`/projects/events/${eventData.id}`, payload)
        else await api.post("/projects/events", payload)
        await reloadEvents()
        setShowEventForm(false)
        setEditingEvent(null)
      } catch (error) {
        console.error("Calendar event save failed", error)
      }
    })()
  }, [reloadEvents])
  const handleDeleteEvent = useCallback((eventId: string | number) => {
    void api.patch(`/projects/events/${eventId}`, { isCancelled: true })
      .then(reloadEvents)
      .catch((error) => console.error("Calendar event cancellation failed", error))
    setShowEventForm(false)
    setEditingEvent(null)
  }, [reloadEvents])
  const handleEditEvent = useCallback((event: CalendarEvent) => {
    setEditingEvent(event)
    setShowEventForm(true)
  }, [])

  return {
    selectedDate, showEventForm, editingEvent, showCalendarSheet, events,
    setSelectedDate, setShowEventForm, setEditingEvent, setShowCalendarSheet,
    handleDateSelect, handleNewEvent, handleNewCalendar, handleSaveEvent, handleDeleteEvent, handleEditEvent,
  }
}
