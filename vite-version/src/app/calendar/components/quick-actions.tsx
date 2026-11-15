"use client"

import {
  Clock,
  Users,
  Plus,
  Settings,
  Download,
  Share,
  Bell,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

interface QuickActionsProps {
  onNewEvent?: () => void
  onNewMeeting?: () => void
  onNewReminder?: () => void
  onSettings?: () => void
}

export function QuickActions({
  onNewEvent,
  onNewMeeting,
  onNewReminder,
  onSettings,
}: QuickActionsProps) {
  const quickStats = [
    { label: "Today's Events", value: "3", color: "bg-[var(--primary)]" },
    { label: "This Week", value: "12", color: "bg-green-500" },
    { label: "Pending", value: "2", color: "bg-orange-500" },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Quick Stats */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Overview</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {quickStats.map((stat, index) => (
            <div key={index} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={cn("size-2 rounded-full", stat.color)} />
                <span className="text-sm text-muted-foreground">
                  {stat.label}
                </span>
              </div>
              <Badge variant="secondary">{stat.value}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button
            variant="outline"
            className="w-full justify-start cursor-pointer"
            onClick={onNewEvent}
          >
            <Plus data-icon="inline-start" />
            New Event
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start cursor-pointer"
            onClick={onNewMeeting}
          >
            <Users data-icon="inline-start" />
            Schedule Meeting
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start cursor-pointer"
            onClick={onNewReminder}
          >
            <Bell data-icon="inline-start" />
            Set Reminder
          </Button>

          <Separator className="mt-3 mb-1" />

          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start cursor-pointer"
          >
            <Share data-icon="inline-start" />
            Share Calendar
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start cursor-pointer"
          >
            <Download data-icon="inline-start" />
            Export
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start cursor-pointer"
            onClick={onSettings}
          >
            <Settings data-icon="inline-start" />
            Settings
          </Button>
        </CardContent>
      </Card>

      {/* Upcoming Events */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="size-4" />
            Next Up
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-3">
              <div className="size-2 bg-[var(--primary)] rounded-full mt-2" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">Team Standup</p>
                <p className="text-xs text-muted-foreground">
                  9:00 AM • Conference Room A
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="size-2 bg-purple-500 rounded-full mt-2" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">Design Review</p>
                <p className="text-xs text-muted-foreground">
                  2:00 PM • Virtual
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
