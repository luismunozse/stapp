"use client"

import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { TERMINOS } from "@/lib/terminologia"

export function VocabularioForm() {
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [resuelto, setResuelto] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/configuracion")
      .then((r) => r.json())
      .then((d) => {
        setResuelto(d.terminologia || {})
      })
      .catch(() => {
        // fail silently; placeholders fall back to catalog defaults
      })
  }, [])

  const setVal = (key: string, val: string) =>
    setOverrides((prev) => ({ ...prev, [key]: val }))

  const guardar = async () => {
    setSaving(true)
    setMsg(null)
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(overrides)) {
      if (v.trim() !== "") clean[k] = v.trim()
    }
    const res = await fetch("/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terminologia: clean }),
    })
    setSaving(false)
    setMsg(res.ok ? "Guardado" : "Error al guardar")
  }

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-sm text-muted-foreground">
        Dejá un campo vacío para usar el término por defecto.
      </p>
      {TERMINOS.map((term) => (
        <div key={term.key} className="space-y-1">
          <Label htmlFor={term.key} className="text-sm">
            {term.label}
          </Label>
          {term.help && (
            <p className="text-xs text-muted-foreground">{term.help}</p>
          )}
          <Input
            id={term.key}
            placeholder={resuelto[term.key] ?? term.default}
            value={overrides[term.key] ?? ""}
            onChange={(e) => setVal(term.key, e.target.value)}
          />
        </div>
      ))}
      <Button onClick={guardar} disabled={saving}>
        {saving ? "Guardando…" : "Guardar"}
      </Button>
      {msg && <p className="text-sm">{msg}</p>}
    </div>
  )
}
