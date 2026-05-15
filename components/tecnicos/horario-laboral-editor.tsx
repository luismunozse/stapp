"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Plus, Trash2, Loader2, Save } from "lucide-react"

type DiaSemana = "lun" | "mar" | "mie" | "jue" | "vie" | "sab" | "dom"
interface Franja { de: string; a: string }
type Horario = Partial<Record<DiaSemana, Franja[]>>

const DIAS: { key: DiaSemana; label: string }[] = [
  { key: "lun", label: "Lunes" },
  { key: "mar", label: "Martes" },
  { key: "mie", label: "Miércoles" },
  { key: "jue", label: "Jueves" },
  { key: "vie", label: "Viernes" },
  { key: "sab", label: "Sábado" },
  { key: "dom", label: "Domingo" },
]

const HORARIO_LV: Horario = {
  lun: [{ de: "09:00", a: "18:00" }],
  mar: [{ de: "09:00", a: "18:00" }],
  mie: [{ de: "09:00", a: "18:00" }],
  jue: [{ de: "09:00", a: "18:00" }],
  vie: [{ de: "09:00", a: "18:00" }],
  sab: [],
  dom: [],
}

interface HorarioLaboralEditorProps {
  tecnicoId: string
  initial: Horario | null
  onSaved?: () => void
}

export function HorarioLaboralEditor({ tecnicoId, initial, onSaved }: HorarioLaboralEditorProps) {
  const [horario, setHorario] = useState<Horario>(initial || {})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    setHorario(initial || {})
  }, [initial])

  const addFranja = (dia: DiaSemana) => {
    setHorario((prev) => ({
      ...prev,
      [dia]: [...(prev[dia] || []), { de: "09:00", a: "18:00" }],
    }))
  }
  const removeFranja = (dia: DiaSemana, idx: number) => {
    setHorario((prev) => ({
      ...prev,
      [dia]: (prev[dia] || []).filter((_, i) => i !== idx),
    }))
  }
  const updateFranja = (dia: DiaSemana, idx: number, campo: "de" | "a", valor: string) => {
    setHorario((prev) => ({
      ...prev,
      [dia]: (prev[dia] || []).map((f, i) => (i === idx ? { ...f, [campo]: valor } : f)),
    }))
  }

  const save = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/tecnicos/${tecnicoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horarioLaboral: horario }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || "Error al guardar")
      }
      setMsg("Guardado")
      onSaved?.()
    } catch (err: any) {
      setMsg(err.message || "Error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Horario laboral</CardTitle>
        <CardDescription className="text-xs">
          Franjas en las que el técnico está disponible para turnos. Se usa para advertir conflictos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setHorario(HORARIO_LV)}
          >
            L-V 9 a 18
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setHorario({})}
          >
            Limpiar
          </Button>
        </div>

        <div className="space-y-2">
          {DIAS.map(({ key, label }) => {
            const franjas = horario[key] || []
            return (
              <div key={key} className="border rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{label}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => addFranja(key)}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Franja
                  </Button>
                </div>
                {franjas.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No trabaja</p>
                ) : (
                  <div className="space-y-1">
                    {franjas.map((f, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Input
                          type="time"
                          value={f.de}
                          onChange={(e) => updateFranja(key, idx, "de", e.target.value)}
                          className="h-8 w-28"
                        />
                        <span className="text-xs text-muted-foreground">a</span>
                        <Input
                          type="time"
                          value={f.a}
                          onChange={(e) => updateFranja(key, idx, "a", e.target.value)}
                          className="h-8 w-28"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => removeFranja(key, idx)}
                          className="h-7 w-7"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-xs text-muted-foreground">{msg}</span>
          <Button onClick={save} disabled={saving} size="sm">
            {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
            Guardar
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
