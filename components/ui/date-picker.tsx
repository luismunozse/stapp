"use client"

import * as React from "react"
import { format, parse } from "date-fns"
import { es } from "date-fns/locale"
import { Calendar as CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Label } from "@/components/ui/label"

function useIsTouchDevice() {
  const [isTouch, setIsTouch] = React.useState(false)
  React.useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia("(hover: none) and (pointer: coarse)")
    setIsTouch(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsTouch(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])
  return isTouch
}

interface DatePickerProps {
  id?: string
  label?: string
  value?: string // formato YYYY-MM-DD
  onChange?: (value: string) => void
  placeholder?: string
  required?: boolean
  min?: string
  max?: string
  disabled?: boolean
  className?: string
}

export function DatePicker({
  id,
  label,
  value,
  onChange,
  placeholder = "Seleccionar fecha",
  required,
  min,
  max,
  disabled,
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const isTouch = useIsTouchDevice()

  // Convertir string YYYY-MM-DD a Date
  const selectedDate = React.useMemo(() => {
    if (!value) return undefined
    try {
      return parse(value, "yyyy-MM-dd", new Date())
    } catch {
      return undefined
    }
  }, [value])

  // Convertir min/max a Date
  const minDate = React.useMemo(() => {
    if (!min) return undefined
    try {
      return parse(min, "yyyy-MM-dd", new Date())
    } catch {
      return undefined
    }
  }, [min])

  const maxDate = React.useMemo(() => {
    if (!max) return undefined
    try {
      return parse(max, "yyyy-MM-dd", new Date())
    } catch {
      return undefined
    }
  }, [max])

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      onChange?.(format(date, "yyyy-MM-dd"))
    } else {
      onChange?.("")
    }
    setOpen(false)
  }

  if (isTouch) {
    return (
      <div className={cn("space-y-2", className)}>
        {label && (
          <Label htmlFor={id}>
            {label}
            {required && <span className="text-destructive ml-1">*</span>}
          </Label>
        )}
        <Input
          id={id}
          type="date"
          value={value || ""}
          onChange={(e) => onChange?.(e.target.value)}
          min={min}
          max={max}
          required={required}
          disabled={disabled}
          placeholder={placeholder}
        />
      </div>
    )
  }

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <Label htmlFor={id}>
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-start text-left font-normal",
              !selectedDate && "text-muted-foreground",
              "hover:bg-accent hover:text-accent-foreground",
              "focus:ring-2 focus:ring-ring focus:ring-offset-2"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
            {selectedDate ? (
              <span className="text-foreground">
                {format(selectedDate, "PPP", { locale: es })}
              </span>
            ) : (
              <span>{placeholder}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleSelect}
            disabled={(date) => {
              if (minDate && date < minDate) return true
              if (maxDate && date > maxDate) return true
              return false
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

// Componente para selección de rango de fechas
interface DateRangePickerProps {
  id?: string
  label?: string
  from?: string
  to?: string
  onChange?: (range: { from: string; to: string }) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function DateRangePicker({
  id,
  label,
  from,
  to,
  onChange,
  placeholder = "Seleccionar rango",
  disabled,
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false)
  const isTouch = useIsTouchDevice()

  const fromDate = React.useMemo(() => {
    if (!from) return undefined
    try {
      return parse(from, "yyyy-MM-dd", new Date())
    } catch {
      return undefined
    }
  }, [from])

  const toDate = React.useMemo(() => {
    if (!to) return undefined
    try {
      return parse(to, "yyyy-MM-dd", new Date())
    } catch {
      return undefined
    }
  }, [to])

  const handleSelect = (range: { from?: Date; to?: Date } | undefined) => {
    if (range) {
      onChange?.({
        from: range.from ? format(range.from, "yyyy-MM-dd") : "",
        to: range.to ? format(range.to, "yyyy-MM-dd") : "",
      })
      // Cerrar solo cuando se seleccionó el rango completo
      if (range.from && range.to) {
        setOpen(false)
      }
    }
  }

  const formatRangeLabel = () => {
    if (fromDate && toDate) {
      return `${format(fromDate, "dd MMM", { locale: es })} - ${format(toDate, "dd MMM yyyy", { locale: es })}`
    }
    if (fromDate) {
      return `${format(fromDate, "dd MMM yyyy", { locale: es })} - ...`
    }
    return placeholder
  }

  if (isTouch) {
    return (
      <div className={cn("space-y-2", className)}>
        {label && <Label htmlFor={id}>{label}</Label>}
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="date"
            value={from || ""}
            onChange={(e) =>
              onChange?.({ from: e.target.value, to: to || "" })
            }
            disabled={disabled}
            placeholder={placeholder}
            className="flex-1"
          />
          <span className="text-muted-foreground text-sm">—</span>
          <Input
            type="date"
            value={to || ""}
            onChange={(e) =>
              onChange?.({ from: from || "", to: e.target.value })
            }
            disabled={disabled}
            className="flex-1"
          />
        </div>
      </div>
    )
  }

  return (
    <div className={cn("space-y-2", className)}>
      {label && <Label htmlFor={id}>{label}</Label>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-start text-left font-normal",
              !fromDate && "text-muted-foreground",
              "hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
            <span className={fromDate ? "text-foreground" : ""}>
              {formatRangeLabel()}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={{ from: fromDate, to: toDate }}
            onSelect={handleSelect}
            numberOfMonths={2}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
