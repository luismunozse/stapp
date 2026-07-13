"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { X, Plus } from "lucide-react"

interface TagsInputProps {
  value: string[]
  onChange: (next: string[]) => void
  suggestions?: string[]
  maxLength?: number
  placeholder?: string
}

export function TagsInput({
  value,
  onChange,
  suggestions = [],
  maxLength = 40,
  placeholder = "Agregar etiqueta…",
}: TagsInputProps) {
  const [draft, setDraft] = useState("")

  const add = (raw: string) => {
    const t = raw.trim().slice(0, maxLength)
    if (!t) return
    if (value.some((v) => v.toLowerCase() === t.toLowerCase())) return
    onChange([...value, t])
  }

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag))

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      add(draft)
      setDraft("")
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      e.preventDefault()
      remove(value[value.length - 1])
    }
  }

  // Commit the pending draft on blur so a typed tag isn't silently lost when
  // the user moves focus (e.g. straight to a Save button) without confirming
  // with Enter or comma.
  const onBlur = () => {
    add(draft)
    setDraft("")
  }

  const freeSuggestions = suggestions.filter(
    (s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()),
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border p-1.5">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
          >
            {tag}
            <button
              type="button"
              aria-label={`Quitar ${tag}`}
              onClick={() => remove(tag)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          placeholder={placeholder}
          maxLength={maxLength}
          className="h-7 flex-1 min-w-[120px] border-0 shadow-none focus-visible:ring-0 px-1"
        />
      </div>
      {freeSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {freeSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              aria-label={`Agregar ${s}`}
              onClick={() => add(s)}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              <Plus className="h-3 w-3" />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
