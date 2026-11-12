"use client"

import { Plus } from "lucide-react"

import { DatePicker } from "./date-picker"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface CalendarSidebarProps {
  selectedDate?: Date
  onDateSelect?: (date: Date) => void
  onNewEvent?: () => void
  events?: Array<{ date: Date; count: number }>
  className?: string
}

export function CalendarSidebar({
  selectedDate,
  onDateSelect,
  onNewEvent,
  events = [],
  className,
}: CalendarSidebarProps) {
  return (
    <div
      className={cn("flex flex-col h-full bg-background rounded-lg", className)}
    >
      {/* Add New Event Button */}
      <div className="p-6 border-b">
        <Button className="w-full cursor-pointer" onClick={onNewEvent}>
          <Plus data-icon="inline-start" />
          Add New Event
        </Button>
      </div>

      {/* Date Picker */}
      <DatePicker
        selectedDate={selectedDate}
        onDateSelect={onDateSelect}
        events={events}
      />

      <Separator />

    </div>
  )
}
