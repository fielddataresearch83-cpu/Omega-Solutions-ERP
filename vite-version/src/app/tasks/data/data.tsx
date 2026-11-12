import { CheckCircle2, Circle, Clock, PlayCircle, XCircle } from "lucide-react"

export const categories = [
  { value: "task", label: "Task" },
  {
    value: "bug",
    label: "Bug",
  },
  {
    value: "feature",
    label: "Feature",
  },
  {
    value: "documentation",
    label: "Docs",
  },
  {
    value: "improvement",
    label: "Improvement",
  },
  {
    value: "refactor",
    label: "Refactor",
  },
]

export const statuses = [
  {
    value: "pending",
    label: "Pending",
    icon: Clock,
  },
  {
    value: "todo",
    label: "Todo",
    icon: Circle,
  },
  {
    value: "in_progress",
    label: "In Progress",
    icon: PlayCircle,
  },
  {
    value: "completed",
    label: "Completed",
    icon: CheckCircle2,
  },
  {
    value: "cancelled",
    label: "Cancelled",
    icon: XCircle,
  },
]

export const priorities = [
  {
    label: "Minor",
    value: "minor",
  },
  {
    label: "Normal",
    value: "normal",
  },
  {
    label: "Important",
    value: "important",
  },
  {
    label: "Critical",
    value: "critical",
  },
  { label: "Urgent", value: "urgent" },
]
