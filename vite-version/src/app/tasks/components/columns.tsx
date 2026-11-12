"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { DataTableFeatures } from "@/lib/data-table"

import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import { categories, priorities, statuses } from "../data/data"
import type { Task } from "../data/schema"
import { DataTableColumnHeader } from "./data-table-column-header"

export const columns: ColumnDef<DataTableFeatures, Task>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={
          table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
        className="translate-y-[2px] cursor-pointer"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
        className="translate-y-[2px] cursor-pointer"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "id",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Task" />
    ),
    cell: ({ row }) => (
      <div className="w-[90px] font-medium">{String(row.getValue("id")).slice(0, 8)}</div>
    ),
    enableHiding: false,
  },
  {
    accessorKey: "title",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Title" />
    ),
    cell: ({ row }) => {
      return (
        <div className="flex gap-2">
          <span className="max-w-[500px] truncate font-medium">
            {row.getValue("title")}
          </span>
        </div>
      )
    },
  },
  {
    accessorKey: "category",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Category" />
    ),
    cell: ({ row }) => {
      const category = categories.find(
        (cat) => cat.value === row.getValue("category")
      )

      if (!category) {
        return null
      }

      return (
        <div className="flex w-[120px] items-center">
          <Badge variant="outline">{category.label}</Badge>
        </div>
      )
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => {
      const status = statuses.find(
        (status) => status.value === row.getValue("status")
      )

      if (!status) {
        return null
      }

      return (
        <div className="flex w-[130px] items-center">
          {status.icon && (
            <status.icon className="mr-2 size-4 text-muted-foreground" />
          )}
          <span className="text-sm">{status.label}</span>
        </div>
      )
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
  },
  {
    accessorKey: "priority",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Priority" />
    ),
    cell: ({ row }) => {
      const priority = priorities.find(
        (priority) => priority.value === row.getValue("priority")
      )

      if (!priority) {
        return null
      }

      const priorityColors = {
        critical: "border-destructive text-destructive",
        urgent: "border-destructive text-destructive",
        important: "border-warning text-warning",
        normal: "border-info text-info",
        minor: "border-gray-500 text-gray-700 dark:text-gray-400",
      }

      return (
        <div className="flex items-center">
          <Badge
            variant="outline"
            className={cn(
              "pl-2",
              priorityColors[priority.value as keyof typeof priorityColors]
            )}
          >
            <span className="text-sm">{priority.label}</span>
          </Badge>
        </div>
      )
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
  },
]


type CompanyMember = { id: string; full_name: string; email: string; role: string }

export function columnsWithUpdates(
  onStatusChange: (task: Task, status: string) => void | Promise<void>,
  onAssigneeChange: (task: Task, assignedTo: string) => void | Promise<void>,
  members: CompanyMember[],
): ColumnDef<DataTableFeatures, Task>[] {
  return [
    ...columns,
    {
      id: "assignee",
      header: "Assigned to",
      enableSorting: false,
      cell: ({ row }) => (
        <Select
          value={row.original.assigned_to ?? "unassigned"}
          onValueChange={(value) => value && void onAssigneeChange(row.original, value === "unassigned" ? "" : value)}
        >
          <SelectTrigger aria-label={`Assign ${row.original.title}`} className="w-[170px]">
            <SelectValue placeholder="Unassigned" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {members.map((member) => (
              <SelectItem key={member.id} value={member.id}>{member.full_name || member.email}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      id: "updateStatus",
      header: "Update status",
      enableSorting: false,
      cell: ({ row }) => (
        <Select
          value={row.original.status}
          onValueChange={(value) => value && void onStatusChange(row.original, value)}
        >
          <SelectTrigger aria-label={`Update status for ${row.original.title}`} className="w-[150px]">
            <SelectValue placeholder="Change status" />
          </SelectTrigger>
          <SelectContent>
            {statuses.map((status) => (
              <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
  ];
}
