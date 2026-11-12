"use client"

import { useEffect, useState } from "react"
import { CalendarIcon, Clock, MapPin, Users, Type, Tag } from "lucide-react"
import { format } from "date-fns"

import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { type CalendarEvent } from "../types"

interface EventFormProps {
  event?: CalendarEvent | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (event: Partial<CalendarEvent>) => void
  onDelete?: (eventId: string | number) => void
}

const eventTypes = [
  { value: "meeting", label: "Meeting", color: "bg-blue-500" },
  { value: "event", label: "Event", color: "bg-green-500" },
  { value: "personal", label: "Personal", color: "bg-pink-500" },
  { value: "task", label: "Task", color: "bg-orange-500" },
  { value: "reminder", label: "Reminder", color: "bg-purple-500" },
]

const timeSlots = [
  "9:00 AM",
  "9:30 AM",
  "10:00 AM",
  "10:30 AM",
  "11:00 AM",
  "11:30 AM",
  "12:00 PM",
  "12:30 PM",
  "1:00 PM",
  "1:30 PM",
  "2:00 PM",
  "2:30 PM",
  "3:00 PM",
  "3:30 PM",
  "4:00 PM",
  "4:30 PM",
  "5:00 PM",
  "5:30 PM",
  "6:00 PM",
  "6:30 PM",
  "7:00 PM",
  "7:30 PM",
  "8:00 PM",
  "8:30 PM",
]

const durationOptions = [
  "15 min",
  "30 min",
  "45 min",
  "1 hour",
  "1.5 hours",
  "2 hours",
  "3 hours",
  "All day",
]

export function EventForm({
  event,
  open,
  onOpenChange,
  onSave,
  onDelete,
}: EventFormProps) {
  const [formData, setFormData] = useState({
    title: event?.title || "",
    date: event?.date || new Date(),
    time: event?.time || "9:00 AM",
    duration: event?.duration || "1 hour",
    type: event?.type || "meeting",
    location: event?.location || "",
    description: event?.description || "",
    attendees: event?.attendees || [],
    allDay: false,
    reminder: true,
  })

  useEffect(() => {
    if (!open) return
    setFormData({
      title: event?.title || "",
      date: event?.date || new Date(),
      time: event?.time || "9:00 AM",
      duration: event?.duration || "1 hour",
      type: event?.type || "meeting",
      location: event?.location || "",
      description: event?.description || "",
      attendees: event?.attendees || [],
      allDay: event?.allDay || false,
      reminder: true,
    })
  }, [event, open])

  const [showCalendar, setShowCalendar] = useState(false)
  const [newAttendee, setNewAttendee] = useState("")

  const handleSave = () => {
    const eventData: Partial<CalendarEvent> = {
      ...formData,
      id: event?.id,
      color:
        eventTypes.find((t) => t.value === formData.type)?.color ||
        "bg-blue-500",
      allDay: formData.allDay,
    }
    onSave(eventData)
    onOpenChange(false)
  }

  const handleDelete = () => {
    if (event?.id && onDelete) {
      onDelete(event.id)
      onOpenChange(false)
    }
  }

  const addAttendee = () => {
    if (
      newAttendee.trim() &&
      !formData.attendees.includes(newAttendee.trim())
    ) {
      setFormData((prev) => ({
        ...prev,
        attendees: [...prev.attendees, newAttendee.trim()],
      }))
      setNewAttendee("")
    }
  }

  const removeAttendee = (attendee: string) => {
    setFormData((prev) => ({
      ...prev,
      attendees: prev.attendees.filter((a) => a !== attendee),
    }))
  }

  const selectedEventType = eventTypes.find((t) => t.value === formData.type)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div
              className={cn("size-3 rounded-full", selectedEventType?.color)}
            />
            {event ? "Edit Event" : "Create New Event"}
          </DialogTitle>
          <DialogDescription>
            {event
              ? "Make changes to this event"
              : "Add a new event to your calendar"}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="flex flex-col gap-6 py-4">
          {/* Event Title */}
          <Field>
            <FieldLabel htmlFor="title" className="flex items-center gap-2">
              <Type className="size-4" />
              Event Title
            </FieldLabel>
            <Input
              id="title"
              placeholder="Enter event title..."
              value={formData.title}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, title: e.target.value }))
              }
              className="text-lg font-medium"
            />
          </Field>

          {/* Event Type */}
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel className="flex items-center gap-2">
                <Tag className="size-4" />
                Event Type
              </FieldLabel>
              <Select
                items={eventTypes}
                value={formData.type}
                onValueChange={(value) =>
                  value &&
                  setFormData((prev) => ({
                    ...prev,
                    type: value as CalendarEvent["type"],
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {eventTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        <div className="flex items-center gap-2">
                          <div
                            className={cn("size-3 rounded-full", type.color)}
                          />
                          {type.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Date and Time */}
          <FieldGroup className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel className="flex items-center gap-2">
                <CalendarIcon className="size-4" />
                Date
              </FieldLabel>
              <Popover open={showCalendar} onOpenChange={setShowCalendar}>
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left font-normal"
                    />
                  }
                >
                  {format(formData.date, "PPP")}
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.date}
                    onSelect={(date) => {
                      if (date) {
                        setFormData((prev) => ({ ...prev, date }))
                        setShowCalendar(false)
                      }
                    }}
                  />
                </PopoverContent>
              </Popover>
            </Field>

            <Field>
              <FieldLabel className="flex items-center gap-2">
                <Clock className="size-4" />
                Time
              </FieldLabel>
              <Select
                value={formData.time}
                onValueChange={(value) =>
                  value && setFormData((prev) => ({ ...prev, time: value }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {timeSlots.map((time) => (
                      <SelectItem key={time} value={time}>
                        {time}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>

          {/* Duration and All Day */}
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel>Duration</FieldLabel>
              <Select
                value={formData.duration}
                onValueChange={(value) =>
                  value && setFormData((prev) => ({ ...prev, duration: value }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {durationOptions.map((duration) => (
                      <SelectItem key={duration} value={duration}>
                        {duration}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <FieldSet>
              <FieldLegend variant="label">Options</FieldLegend>
              <FieldGroup className="flex-row items-center gap-4 h-10">
                <Field orientation="horizontal">
                  <Switch
                    id="all-day"
                    checked={formData.allDay}
                    onCheckedChange={(checked) =>
                      setFormData((prev) => ({ ...prev, allDay: checked }))
                    }
                  />
                  <FieldLabel htmlFor="all-day" className="text-sm">
                    All day
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Switch
                    id="reminder"
                    checked={formData.reminder}
                    onCheckedChange={(checked) =>
                      setFormData((prev) => ({ ...prev, reminder: checked }))
                    }
                  />
                  <FieldLabel htmlFor="reminder" className="text-sm">
                    Reminder
                  </FieldLabel>
                </Field>
              </FieldGroup>
            </FieldSet>
          </div>

          {/* Location */}
          <Field>
            <FieldLabel htmlFor="location" className="flex items-center gap-2">
              <MapPin className="size-4" />
              Location
            </FieldLabel>
            <Input
              id="location"
              placeholder="Add location..."
              value={formData.location}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, location: e.target.value }))
              }
            />
          </Field>

          {/* Attendees */}
          <Field>
            <FieldLabel
              htmlFor="event-attendee"
              className="flex items-center gap-2"
            >
              <Users className="size-4" />
              Attendees
            </FieldLabel>
            <div className="flex gap-2">
              <Input
                id="event-attendee"
                placeholder="Add attendee..."
                value={newAttendee}
                onChange={(e) => setNewAttendee(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && addAttendee()}
              />
              <Button
                onClick={addAttendee}
                variant="outline"
                className="cursor-pointer"
              >
                Add
              </Button>
            </div>
            {formData.attendees.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.attendees.map((attendee, index) => (
                  <Badge
                    key={index}
                    variant="secondary"
                    className="flex items-center gap-2 px-2 py-1"
                  >
                    <Avatar className="size-5">
                      <AvatarFallback className="text-[10px] font-medium">
                        {attendee
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{attendee}</span>
                    <button
                      onClick={() => removeAttendee(attendee)}
                      className="text-muted-foreground hover:text-foreground cursor-pointer"
                      type="button"
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </Field>

          {/* Description */}
          <Field>
            <FieldLabel htmlFor="description">Description</FieldLabel>
            <Textarea
              id="description"
              placeholder="Add description..."
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              rows={3}
            />
          </Field>

          {/* Actions */}
          <div className="flex gap-3 pt-6">
            <Button onClick={handleSave} className="flex-1 cursor-pointer">
              {event ? "Update Event" : "Create Event"}
            </Button>
            {event && onDelete && (
              <Button
                onClick={handleDelete}
                variant="destructive"
                className="cursor-pointer"
              >
                Delete
              </Button>
            )}
            <Button
              onClick={() => onOpenChange(false)}
              variant="outline"
              className="cursor-pointer"
            >
              Cancel
            </Button>
          </div>
        </FieldGroup>
      </DialogContent>
    </Dialog>
  )
}
