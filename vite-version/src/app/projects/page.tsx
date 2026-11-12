"use client"

import { useCallback, useEffect, useState } from "react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/lib/api-client"

type CompanyMember = { id: string; full_name: string; email: string; role: string }

type Project = {
  id: string
  name: string
  description: string | null
  status: "planned" | "active" | "on_hold" | "completed" | "cancelled"
  priority: string
  start_date: string | null
  due_date: string | null
  owner_user_id: string | null
  owner_name: string | null
  task_count: number
  completed_tasks: number
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [members, setMembers] = useState<CompanyMember[]>([])
  const [ownerUserId, setOwnerUserId] = useState("")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const reload = useCallback(async () => {
    try {
      setError("")
      const [rows, companyMembers] = await Promise.all([api.get<Project[]>("/projects"), api.get<CompanyMember[]>("/projects/members")])
      setProjects(rows)
      setMembers(companyMembers)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load projects.")
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void reload() }, [reload])

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await api.post("/projects", { name: name.trim(), description: description.trim() || undefined, dueDate: dueDate || undefined, ownerUserId: ownerUserId || undefined })
      setName(""); setDescription(""); setDueDate(""); setOwnerUserId("")
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create project.")
    } finally { setSaving(false) }
  }

  const changeOwner = async (project: Project, ownerUserId: string) => {
    try {
      await api.patch(`/projects/${project.id}`, { ownerUserId: ownerUserId || null })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update project owner.")
    }
  }

  const changeStatus = async (project: Project, status: Project["status"]) => {
    try {
      await api.patch(`/projects/${project.id}`, { status })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update project.")
    }
  }

  return (
    <BaseLayout title="Projects" description="Plan work, assign ownership and track delivery across your company.">
      <div className="flex flex-col gap-6 px-4 md:px-6">
        {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}
        <Card>
          <CardHeader><CardTitle>Create a project</CardTitle><CardDescription>Projects are visible only to members of the selected company.</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={createProject} className="grid gap-3 md:grid-cols-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" required maxLength={180} />
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date" />
              <select className="h-10 rounded-md border bg-background px-3 text-sm md:col-span-2" value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)} aria-label="Project owner">
                <option value="">Assign project owner (default: you)</option>
                {members.map((member) => <option key={member.id} value={member.id}>{member.full_name || member.email} · {member.role}</option>)}
              </select>
              <div className="md:col-span-2"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs to be delivered?" rows={2} /></div>
              <div className="md:col-span-2"><Button type="submit" disabled={saving || !name.trim()}>{saving ? "Creating…" : "Create project"}</Button></div>
            </form>
          </CardContent>
        </Card>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loading ? <p className="text-sm text-muted-foreground">Loading projects…</p> : projects.length === 0 ? <Card className="md:col-span-2 xl:col-span-3"><CardContent className="py-10 text-center text-sm text-muted-foreground">No projects yet. Create the first project above.</CardContent></Card> : projects.map((project) => (
            <Card key={project.id}>
              <CardHeader><div className="flex items-start justify-between gap-3"><div className="min-w-0"><CardTitle className="truncate">{project.name}</CardTitle><CardDescription className="mt-1">{project.description || "No description provided"}</CardDescription></div><span className="rounded-full bg-muted px-2 py-1 text-xs capitalize">{project.status.replace("_", " ")}</span></div></CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tasks completed</span><span className="font-medium">{project.completed_tasks}/{project.task_count}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: project.task_count ? `${Math.round(project.completed_tasks / project.task_count * 100)}%` : "0%" }} /></div>
                <div className="text-xs text-muted-foreground">Owner: {project.owner_name || "Unassigned"} · Due: {project.due_date ? new Date(project.due_date).toLocaleDateString() : "Not set"}</div>
                <label className="grid gap-1 text-xs text-muted-foreground">Project owner
                  <select className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={project.owner_user_id || ""} onChange={(e) => void changeOwner(project, e.target.value)} aria-label={`Owner for ${project.name}`}>
                    <option value="">Unassigned</option>
                    {members.map((member) => <option key={member.id} value={member.id}>{member.full_name || member.email}</option>)}
                  </select>
                </label>
                <select className="h-9 rounded-md border bg-background px-3 text-sm" value={project.status} onChange={(e) => void changeStatus(project, e.target.value as Project["status"])} aria-label={`Status for ${project.name}`}>
                  {["planned","active","on_hold","completed","cancelled"].map((status) => <option key={status} value={status}>{status.replace("_", " ")}</option>)}
                </select>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </BaseLayout>
  )
}
