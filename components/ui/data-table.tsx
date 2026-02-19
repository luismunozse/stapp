"use client"

import * as React from "react"
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileX,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "./button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"
import { DatePicker } from "./date-picker"
import { SkeletonTable } from "./skeleton"
import { EmptyState } from "./empty-state"

// Types
export interface Column<T> {
  key: string
  header: string
  sortable?: boolean
  className?: string
  headerClassName?: string
  render?: (item: T) => React.ReactNode
  // Responsive: ocultar columna en ciertos breakpoints
  hideOnMobile?: boolean // Oculta en < sm
  hideOnTablet?: boolean // Oculta en < md
}

export interface DataTableProps<T> {
  data: T[]
  columns: Column<T>[]
  keyExtractor: (item: T) => string
  loading?: boolean
  emptyMessage?: string
  // Sorting
  sortKey?: string
  sortDirection?: "asc" | "desc"
  onSort?: (key: string) => void
  // Pagination
  pagination?: {
    page: number
    pageSize: number
    total: number
    onPageChange: (page: number) => void
    onPageSizeChange?: (size: number) => void
    pageSizeOptions?: number[]
  }
  // Row actions
  onRowClick?: (item: T) => void
  rowClassName?: (item: T) => string
  // Selection
  selectable?: boolean
  selectedKeys?: string[]
  onSelectionChange?: (keys: string[]) => void
}

const EMPTY_KEYS: string[] = []

export function DataTable<T>({
  data,
  columns,
  keyExtractor,
  loading = false,
  emptyMessage = "No hay datos para mostrar",
  sortKey,
  sortDirection,
  onSort,
  pagination,
  onRowClick,
  rowClassName,
  selectable,
  selectedKeys = EMPTY_KEYS,
  onSelectionChange,
}: DataTableProps<T>) {
  const handleSort = (key: string) => {
    if (onSort) {
      onSort(key)
    }
  }

  const handleSelectAll = () => {
    if (!onSelectionChange) return
    if (selectedKeys.length === data.length) {
      onSelectionChange([])
    } else {
      onSelectionChange(data.map(keyExtractor))
    }
  }

  const handleSelectRow = (key: string) => {
    if (!onSelectionChange) return
    if (selectedKeys.includes(key)) {
      onSelectionChange(selectedKeys.filter((k) => k !== key))
    } else {
      onSelectionChange([...selectedKeys, key])
    }
  }

  const renderSortIcon = (key: string) => {
    if (sortKey !== key) {
      return <ChevronsUpDown className="h-4 w-4 text-muted-foreground/50" />
    }
    return sortDirection === "asc" ? (
      <ChevronUp className="h-4 w-4" />
    ) : (
      <ChevronDown className="h-4 w-4" />
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {selectable && (
                  <th className="w-12 px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={data.length > 0 && selectedKeys.length === data.length}
                      onChange={handleSelectAll}
                      className="h-4 w-4 rounded border-input"
                    />
                  </th>
                )}
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={cn(
                      "px-4 py-3 text-left font-medium text-muted-foreground",
                      column.sortable && "cursor-pointer select-none hover:text-foreground",
                      column.hideOnMobile && "hidden sm:table-cell",
                      column.hideOnTablet && "hidden md:table-cell",
                      column.headerClassName
                    )}
                    onClick={() => column.sortable && handleSort(column.key)}
                  >
                    <div className="flex items-center gap-1">
                      {column.header}
                      {column.sortable && renderSortIcon(column.key)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={columns.length + (selectable ? 1 : 0)} className="p-0">
                    <SkeletonTable rows={5} columns={columns.length + (selectable ? 1 : 0)} />
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + (selectable ? 1 : 0)} className="p-0">
                    <EmptyState
                      icon={FileX}
                      title={emptyMessage}
                      description="Intenta ajustar los filtros o crea un nuevo registro"
                    />
                  </td>
                </tr>
              ) : (
                data.map((item) => {
                  const key = keyExtractor(item)
                  const isSelected = selectedKeys.includes(key)
                  return (
                    <tr
                      key={key}
                      className={cn(
                        "border-b last:border-0 transition-colors",
                        onRowClick && "cursor-pointer hover:bg-muted/50",
                        isSelected && "bg-primary/5",
                        rowClassName?.(item)
                      )}
                      onClick={() => onRowClick?.(item)}
                    >
                      {selectable && (
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleSelectRow(key)}
                            className="h-4 w-4 rounded border-input"
                          />
                        </td>
                      )}
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={cn(
                            "px-4 py-3",
                            column.hideOnMobile && "hidden sm:table-cell",
                            column.hideOnTablet && "hidden md:table-cell",
                            column.className
                          )}
                        >
                          {column.render
                            ? column.render(item)
                            : (item as any)[column.key]}
                        </td>
                      ))}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pagination && (
        <DataTablePagination {...pagination} dataLength={data.length} />
      )}
    </div>
  )
}

// Pagination component
interface DataTablePaginationProps {
  page: number
  pageSize: number
  total: number
  dataLength: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
}

function DataTablePagination({
  page,
  pageSize,
  total,
  dataLength,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
}: DataTablePaginationProps) {
  const totalPages = Math.ceil(total / pageSize)
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="hidden xs:inline">
          Mostrando {start} - {end} de {total}
        </span>
        <span className="xs:hidden">
          {start}-{end}/{total}
        </span>
        {onPageSizeChange && (
          <>
            <span className="hidden sm:inline">|</span>
            <div className="hidden sm:flex items-center gap-1">
              <span>Filas:</span>
              <Select
                value={pageSize.toString()}
                onValueChange={(value) => onPageSizeChange(Number(value))}
              >
                <SelectTrigger className="h-8 w-auto min-w-[60px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageSizeOptions.map((size) => (
                    <SelectItem key={size} value={size.toString()}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 sm:h-8 sm:w-8"
          onClick={() => onPageChange(1)}
          disabled={page === 1}
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 sm:h-8 sm:w-8"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-1 mx-2">
          <span className="text-sm whitespace-nowrap">
            {page}/{totalPages}
          </span>
        </div>

        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 sm:h-8 sm:w-8"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 sm:h-8 sm:w-8"
          onClick={() => onPageChange(totalPages)}
          disabled={page >= totalPages}
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// Filter bar component
interface FilterOption {
  value: string
  label: string
}

interface Filter {
  key: string
  label: string
  type: "select" | "date" | "dateRange"
  options?: FilterOption[]
  value: string
  onChange: (value: string) => void
}

interface DataTableFiltersProps {
  filters: Filter[]
  onClearAll?: () => void
}

export function DataTableFilters({ filters, onClearAll }: DataTableFiltersProps) {
  const hasActiveFilters = filters.some((f) => f.value !== "")

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((filter) => (
        <div key={filter.key} className="flex items-center gap-1 w-full sm:w-auto">
          {filter.type === "select" && filter.options && (
            <Select
              value={filter.value || "all"}
              onValueChange={(value) => filter.onChange(value === "all" ? "" : value)}
            >
              <SelectTrigger className="h-9 w-full sm:w-auto sm:min-w-[140px]">
                <SelectValue placeholder={filter.label} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{filter.label}</SelectItem>
                {filter.options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {filter.type === "date" && (
            <DatePicker
              value={filter.value}
              onChange={filter.onChange}
              placeholder={filter.label}
            />
          )}
        </div>
      ))}
      {hasActiveFilters && onClearAll && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearAll}
          className="h-9 text-muted-foreground"
        >
          Limpiar filtros
        </Button>
      )}
    </div>
  )
}

export { DataTablePagination }
