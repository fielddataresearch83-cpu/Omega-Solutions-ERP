"use client"

import { useCallback, useEffect, useState } from "react"
import { z } from "zod"
import { BarChart3, CheckCircle2, Clock, ListTodo } from "lucide-react"

import { BaseLayout } from "@/components/layouts/base-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { columnsWithUpdates } from "./components/columns"
import { DataTable } from "./components/data-table"
import { taskSchema, type Task } from "./data/schema"
import { api } from "@/lib/api-client"

type CompanyMember = { id: string; full_name: string; email: string; role: string }

export default function TaskPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [members, setMembers] = useState<CompanyMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const loadTasks = useCallback(async () => {
    try {
      setError("")
      const [rows, companyMembers] = await Promise.all([
        api.get<Task[]>("/projects/tasks"),
        api.get<CompanyMember[]>("/projects/members"),
      ])
      setTasks(z.array(taskSchema).parse(rows))
      setMembers(companyMembers)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load company tasks.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadTasks() }, [loadTasks])

  const handleUpdateTaskStatus = async (task: Task, status: string) => {
    try {
      setError("")
      await api.patch(`/projects/tasks/${task.id}`, { status })
      await loadTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update task status.")
    }
  }

  const handleUpdateTaskAssignee = async (task: Task, assignedTo: string) => {
    try {
      setError("")
      await api.patch(`/projects/tasks/${task.id}`, { assignedTo: assignedTo || null })
      await loadTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reassign task.")
    }
  }

  const handleAddTask = async (newTask: Task) => {
    await api.post("/projects/tasks", {
      title: newTask.title,
      description: newTask.description,
      status: newTask.status === "in progress" ? "in_progress" : newTask.status,
      category: newTask.category,
      priority: newTask.priority,
      assignedTo: newTask.assigned_to ?? undefined,
    })
    await loadTasks()
  }

  const stats = {
    total: tasks.length,
    completed: tasks.filter((t) => t.status === "completed").length,
    inProgress: tasks.filter((t) => t.status === "in_progress" || t.status === "in progress").length,
    pending: tasks.filter((t) => t.status === "pending" || t.status === "todo").length,
  }

  if (loading) {
    return <BaseLayout title="Tasks" description="Company tasks and delivery tracking">
      <div className="flex h-96 items-center justify-center text-muted-foreground">Loading company tasks…</div>
    </BaseLayout>
  }

  return (
    <BaseLayout title="Tasks" description="Company tasks and delivery tracking">
      <div className="flex flex-col gap-6 px-4 md:px-6">
        {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card><CardContent><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Total tasks</p><p className="mt-1 text-2xl font-bold">{stats.total}</p></div><ListTodo className="size-6 text-muted-foreground" /></div></CardContent></Card>
          <Card><CardContent><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Completed</p><p className="mt-1 text-2xl font-bold">{stats.completed}</p></div><CheckCircle2 className="size-6 text-muted-foreground" /></div></CardContent></Card>
          <Card><CardContent><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">In progress</p><p className="mt-1 text-2xl font-bold">{stats.inProgress}</p></div><Clock className="size-6 text-muted-foreground" /></div></CardContent></Card>
          <Card><CardContent><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">To do / pending</p><p className="mt-1 text-2xl font-bold">{stats.pending}</p></div><BarChart3 className="size-6 text-muted-foreground" /></div></CardContent></Card>
        </div>
        <Card>
          <CardHeader><CardTitle>Task management</CardTitle><CardDescription>Tasks are stored against the selected company and shared with its authorized members.</CardDescription></CardHeader>
          <CardContent><DataTable data={tasks} columns={columnsWithUpdates(handleUpdateTaskStatus, handleUpdateTaskAssignee, members)} onAddTask={handleAddTask} members={members} /></CardContent>
        </Card>
      </div>
    </BaseLayout>
  )
}
