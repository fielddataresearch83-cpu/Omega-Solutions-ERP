"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { z } from "zod"

import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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

import { priorities, statuses, categories } from "../data/data"
import type { Task } from "../data/schema"

// Extended task schema for the form
const taskFormSchema = z.object({
  id: z.string(),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  status: z.string(),
  category: z.string(),
  priority: z.string(),
  assignedTo: z.string().optional(),
  dueAt: z.string().optional(),
  projectId: z.string().optional(),
})

type TaskFormData = z.infer<typeof taskFormSchema>

type CompanyMember = { id: string; full_name: string; email: string; role: string }
type ProjectOption = { id: string; name: string }

interface AddTaskModalProps {
  onAddTask?: (task: Task) => void | Promise<void>
  members?: CompanyMember[]
  projects?: ProjectOption[]
  trigger?: React.ReactElement
}

export function AddTaskModal({ onAddTask, members = [], projects = [], trigger }: AddTaskModalProps) {
  const [open, setOpen] = useState(false)
  const [formData, setFormData] = useState<TaskFormData>({
    id: "",
    title: "",
    description: "",
    status: "todo",
    category: "feature",
    priority: "normal",
    assignedTo: "",
    dueAt: "",
    projectId: "",
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Generate unique task ID
  const generateTaskId = () => {
    const prefix = "TASK"
    const number = Math.floor(Math.random() * 9999) + 1000
    return `${prefix}-${number}`
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      // Validate form data
      const validatedData = taskFormSchema.parse({
        ...formData,
        id: generateTaskId(),
      })

      // Create the task
      const newTask: Task = {
        id: validatedData.id,
        title: validatedData.title,
        description: validatedData.description,
        status: validatedData.status,
        category: validatedData.category,
        priority: validatedData.priority,
        assigned_to: validatedData.assignedTo || null,
        due_at: validatedData.dueAt || null,
        project_id: validatedData.projectId || null,
      }

      await onAddTask?.(newTask)

      // Reset form and close modal
      setFormData({
        id: "",
        title: "",
        description: "",
        status: "todo",
        category: "feature",
        priority: "normal",
        assignedTo: "",
        dueAt: "",
        projectId: "",
      })
      setErrors({})
      setOpen(false)
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {}
        error.issues.forEach((issue) => {
          if (issue.path[0]) newErrors[issue.path[0] as string] = issue.message
        })
        setErrors(newErrors)
      } else {
        setErrors((previous) => ({
          ...previous,
          form: error instanceof Error ? error.message : "Unable to create task.",
        }))
      }
    }
  }

  const handleCancel = () => {
    setFormData({
      id: "",
      title: "",
      description: "",
      status: "todo",
      category: "feature",
      priority: "normal",
      assignedTo: "",
      dueAt: "",
      projectId: "",
    })
    setErrors({})
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger render={trigger} />
      ) : (
        <DialogTrigger
          render={
            <Button variant="default" size="sm" className="cursor-pointer" />
          }
        >
          <Plus data-icon="inline-start" />
          Add Task
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Add New Task</DialogTitle>
          <DialogDescription>
            Create a new task to track work and progress. Fill in the details
            below.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <FieldGroup>
            {/* Task Title */}
            <Field>
              <FieldLabel htmlFor="title">Task Title *</FieldLabel>
              <Input
                id="title"
                placeholder="Enter task title..."
                value={formData.title}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, title: e.target.value }))
                }
                className={errors.title ? "border-destructive" : ""}
              />
              {errors.title && (
                <p className="text-sm text-destructive">{errors.title}</p>
              )}
            </Field>

            {/* Task Description */}
            <Field>
              <FieldLabel htmlFor="description">Description</FieldLabel>
              <Textarea
                id="description"
                placeholder="Provide additional details about the task..."
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

            {/* Task Status and Category - Side by Side */}
          </FieldGroup>
          <FieldGroup className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Task Status */}
            <Field>
              <FieldLabel htmlFor="status">Status</FieldLabel>
              <Select
                items={statuses}
                value={formData.status}
                onValueChange={(value) =>
                  value && setFormData((prev) => ({ ...prev, status: value }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {statuses.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        <div className="flex items-center">
                          {status.icon && (
                            <status.icon className="mr-2 size-4 text-muted-foreground" />
                          )}
                          {status.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            {/* Task Category */}
            <Field>
              <FieldLabel htmlFor="category">Category</FieldLabel>
              <Select
                items={categories}
                value={formData.category}
                onValueChange={(value) =>
                  value && setFormData((prev) => ({ ...prev, category: value }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {categories.map((category) => (
                      <SelectItem key={category.value} value={category.value}>
                        {category.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>

          <FieldGroup>{/* Task Priority - Half Width on Desktop */}</FieldGroup>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="priority">Priority</FieldLabel>
              <Select
                items={priorities}
                value={formData.priority}
                onValueChange={(value) =>
                  value && setFormData((prev) => ({ ...prev, priority: value }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {priorities.map((priority) => (
                      <SelectItem key={priority.value} value={priority.value}>
                        <div className="flex items-center">
                          {priority.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="project">Project</FieldLabel>
            <Select
              value={formData.projectId || "unassigned"}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, projectId: value === "unassigned" ? "" : value ?? "" }))}
            >
              <SelectTrigger className="w-full"><SelectValue placeholder="No project" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="unassigned">No project</SelectItem>
                  {projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="dueAt">Due date</FieldLabel>
            <Input id="dueAt" type="date" value={formData.dueAt ?? ""} onChange={(e) => setFormData((prev) => ({ ...prev, dueAt: e.target.value }))} />
          </Field>
          <Field>
            <FieldLabel htmlFor="assignee">Assign to</FieldLabel>
            <Select
              value={formData.assignedTo || "unassigned"}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, assignedTo: value === "unassigned" ? "" : value ?? "" }))}
            >
              <SelectTrigger className="w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>{member.full_name || member.email} · {member.role}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button type="submit" className="cursor-pointer">
              <Plus data-icon="inline-start" />
              Create Task
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
