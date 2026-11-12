"use client"

import type { ReactTable, RowData } from "@tanstack/react-table"
import type { DataTableFeatures } from "@/lib/data-table"
import { RefreshCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DataTableViewOptions } from "@/app/tasks/components/data-table-view-options"
import { AddTaskModal } from "./add-task-modal"

import { categories, priorities, statuses } from "../data/data"
import type { Task } from "../data/schema"

type CompanyMember = { id: string; full_name: string; email: string; role: string }
type ProjectOption = { id: string; name: string }

interface DataTableToolbarProps<TData extends RowData> {
  table: ReactTable<DataTableFeatures, TData>
  onAddTask?: (task: Task) => void | Promise<void>
  members?: CompanyMember[]
  projects?: ProjectOption[]
}

export function DataTableToolbar<TData extends RowData>({
  table,
  onAddTask,
  members = [],
  projects = [],
}: DataTableToolbarProps<TData>) {
  const isFiltered = table.state.columnFilters.length > 0

  const handleStatusChange = (value: string | null) => {
    const column = table.getColumn("status")
    if (!value || value === "all") {
      column?.setFilterValue(undefined)
    } else {
      column?.setFilterValue(value)
    }
  }

  const handleCategoryChange = (value: string | null) => {
    const column = table.getColumn("category")
    if (!value || value === "all") {
      column?.setFilterValue(undefined)
    } else {
      column?.setFilterValue(value)
    }
  }

  const handlePriorityChange = (value: string | null) => {
    const column = table.getColumn("priority")
    if (!value || value === "all") {
      column?.setFilterValue(undefined)
    } else {
      column?.setFilterValue(value)
    }
  }

  const statusFilter = table.getColumn("status")?.getFilterValue() as
    string | undefined
  const categoryFilter = table.getColumn("category")?.getFilterValue() as
    string | undefined
  const priorityFilter = table.getColumn("priority")?.getFilterValue() as
    string | undefined

  return (
    <div className="flex flex-col gap-4">
      {/* Filter Section */}
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {/* Status Filter */}
          <Select
            items={[{ label: "All Status", value: "all" }, ...statuses]}
            value={statusFilter || "all"}
            onValueChange={handleStatusChange}
          >
            <SelectTrigger className="w-full cursor-pointer">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all" className="cursor-pointer">
                  All Status
                </SelectItem>
                {statuses.map((status) => (
                  <SelectItem
                    key={status.value}
                    value={status.value}
                    className="cursor-pointer"
                  >
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

          {/* Category Filter */}
          <Select
            items={[{ label: "All Categories", value: "all" }, ...categories]}
            value={categoryFilter || "all"}
            onValueChange={handleCategoryChange}
          >
            <SelectTrigger className="w-full cursor-pointer">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all" className="cursor-pointer">
                  All Categories
                </SelectItem>
                {categories.map((category) => (
                  <SelectItem
                    key={category.value}
                    value={category.value}
                    className="cursor-pointer"
                  >
                    {category.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          {/* Priority Filter */}
          <Select
            items={[{ label: "All Priorities", value: "all" }, ...priorities]}
            value={priorityFilter || "all"}
            onValueChange={handlePriorityChange}
          >
            <SelectTrigger className="w-full cursor-pointer">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all" className="cursor-pointer">
                  All Priorities
                </SelectItem>
                {priorities.map((priority) => (
                  <SelectItem
                    key={priority.value}
                    value={priority.value}
                    className="cursor-pointer"
                  >
                    <div className="flex items-center">{priority.label}</div>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Search and Actions Section */}
      <div className="flex items-center justify-between">
        <div className="flex flex-1 items-center gap-2">
          <Input
            placeholder="Search Task"
            value={(table.getColumn("title")?.getFilterValue() as string) ?? ""}
            onChange={(event) =>
              table.getColumn("title")?.setFilterValue(event.target.value)
            }
            className=" w-[200px] lg:w-[300px] cursor-text"
          />
          <Button
            variant="outline"
            onClick={() => table.resetColumnFilters()}
            className="px-3 cursor-pointer"
            disabled={!isFiltered}
          >
            <RefreshCcw data-icon="inline-start" />
            <span className="hidden lg:block">Reset Filters</span>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <DataTableViewOptions table={table} />
          <AddTaskModal onAddTask={onAddTask} members={members} projects={projects} />
        </div>
      </div>
    </div>
  )
}
