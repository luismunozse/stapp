"use client"

import { useState } from "react"
import { Pencil, X, Check, Loader2, type LucideIcon } from "lucide-react"
import { Button } from "./button"
import { FieldSectionLabel } from "./field-section-label"
import { cn } from "@/lib/utils"

interface EditableTextFieldProps {
  icon?: LucideIcon
  label: React.ReactNode
  /** Current saved value ("" when none). */
  value: string
  /** Persist the draft. Return true to close the editor, false to keep it open. */
  onSave: (next: string) => Promise<boolean>
  placeholder?: string
  /** Disable Guardar when the draft is empty (e.g. a required field). */
  requireValue?: boolean
  /** Italic hint shown in read mode when there's no value. */
  emptyHint?: string
  /** Extra classes on the read-mode value paragraph (e.g. a tinted box). */
  valueClassName?: string
  /** Extra classes on the textarea (e.g. a tinted background). */
  textareaClassName?: string
}

/**
 * Inline-editable multiline text field with pencil → textarea → save/cancel.
 * Owns its own editing/draft/saving state; the parent only supplies the saved
 * value and an async `onSave`. Replaces the three copy-pasted Problema /
 * Diagnóstico / Notas blocks in the order detail.
 */
export function EditableTextField({
  icon,
  label,
  value,
  onSave,
  placeholder,
  requireValue = false,
  emptyHint,
  valueClassName,
  textareaClassName,
}: EditableTextFieldProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)

  const startEdit = () => {
    setDraft(value)
    setEditing(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const ok = await onSave(draft)
      if (ok) setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <FieldSectionLabel icon={icon}>{label}</FieldSectionLabel>
        {!editing && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-muted-foreground hover:text-foreground"
            onClick={startEdit}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            className={cn(
              "min-h-[80px] w-full resize-y rounded-md border bg-background p-2 text-sm",
              textareaClassName
            )}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            disabled={saving}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              <X className="mr-1 h-3 w-3" />
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || (requireValue && !draft.trim())}
            >
              {saving ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Check className="mr-1 h-3 w-3" />
              )}
              Guardar
            </Button>
          </div>
        </div>
      ) : value ? (
        <p className={cn("whitespace-pre-wrap text-sm", valueClassName)}>{value}</p>
      ) : emptyHint ? (
        <p className="text-sm italic text-muted-foreground">{emptyHint}</p>
      ) : null}
    </div>
  )
}
