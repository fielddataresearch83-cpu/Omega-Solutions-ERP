import { BaseLayout } from "@/components/layouts/base-layout"
import { Calendar } from "./components/calendar"

export default function CalendarPage() {
  return (
    <BaseLayout title="Calendar" description="Manage your schedule and events">
      <div className="px-4 lg:px-6">
        <Calendar events={[]} />
      </div>
    </BaseLayout>
  )
}
