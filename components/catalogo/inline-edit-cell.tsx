"use client"

import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import type { ParseResult } from "@/lib/catalogo/inline-edit"

interface InlineEditCellProps {
  value: number | null
  parse: (raw: string) => ParseResult
  onSave: (value: number | null) => Promise<void>
  format: (value: number | null) => React.ReactNode
  ariaLabel: string
  placeholder?: React.ReactNode
  align?: "left" | "right"
}

export function InlineEditCell({
  value,
  parse,
  onSave,
  format,
  ariaLabel,
  placeholder,
  align = "right",
}: InlineEditCellProps) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState("")
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const editingRef = useRef(false)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const open = () => {
    setRaw(value == null ? "" : String(value))
    editingRef.current = true
    setEditing(true)
  }

  const cancel = () => {
    editingRef.current = false
    setEditing(false)
    setRaw("")
  }

  const commit = async () => {
    if (saving || !editingRef.current) return
    const parsed = parse(raw)
    if (!parsed.ok) {
      cancel()
      return
    }
    if (parsed.value === value) {
      cancel()
      return
    }
    editingRef.current = false
    setSaving(true)
    try {
      await onSave(parsed.value)
    } finally {
      setSaving(false)
      setEditing(false)
      setRaw("")
    }
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        type="number"
        inputMode="decimal"
        value={raw}
        disabled={saving}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            cancel()
          }
        }}
        className="h-7 w-24 text-sm tabular-nums"
        aria-label={ariaLabel}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={open}
      aria-label={ariaLabel}
      className={`tabular-nums hover:underline decoration-dotted underline-offset-4 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {value == null && placeholder != null ? placeholder : format(value)}
    </button>
  )
}
