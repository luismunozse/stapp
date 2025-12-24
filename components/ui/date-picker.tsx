"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Calendar } from "lucide-react"
import { Button } from "@/components/ui/button"

interface DatePickerProps {
  id?: string
  label?: string
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  required?: boolean
  min?: string
  max?: string
}

export function DatePicker({
  id,
  label,
  value,
  onChange,
  placeholder = "dd/mm/aaaa",
  required,
  min,
  max,
}: DatePickerProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleIconClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (inputRef.current) {
      // Intentar abrir el picker nativo (funciona en Chrome, Edge, Safari 14+)
      if (inputRef.current.showPicker) {
        try {
          inputRef.current.showPicker()
        } catch (err) {
          // Fallback: hacer focus
          inputRef.current.focus()
          inputRef.current.click()
        }
      } else {
        // Fallback para navegadores que no soportan showPicker
        inputRef.current.focus()
        inputRef.current.click()
      }
    }
  }

  const handleInputClick = () => {
    if (inputRef.current) {
      // En móviles, hacer focus abre el picker
      inputRef.current.focus()
    }
  }

  return (
    <div className="space-y-2">
      {label && <Label htmlFor={id}>{label}</Label>}
      <div className="relative">
        <Input
          ref={inputRef}
          id={id}
          type="date"
          value={value || ""}
          onChange={(e) => onChange?.(e.target.value)}
          onClick={handleInputClick}
          onFocus={handleInputClick}
          required={required}
          min={min}
          max={max}
          className="pr-10 cursor-pointer"
          placeholder={placeholder}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent pointer-events-auto"
          onClick={handleIconClick}
          aria-label="Abrir calendario"
        >
          <Calendar className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>
    </div>
  )
}

