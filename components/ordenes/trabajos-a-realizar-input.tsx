"use client"

import { useState } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  TRABAJO_A_REALIZAR_MAX,
  joinTrabajosARealizar,
  parseTrabajosARealizar,
} from "@/lib/ordenes/trabajo-a-realizar"

interface TrabajosARealizarInputProps {
  /** id del primer campo, para asociarle el <Label> externo. */
  id: string
  /** Texto guardado: un trabajo por línea. */
  value: string | null | undefined
  /**
   * Se llama con el texto a guardar (un trabajo por línea, null si no queda
   * ninguno) al salir de un campo o al quitar un trabajo.
   */
  onCommit: (value: string | null) => void
  placeholder?: string
  /** Avisar en cada cambio (formularios) en lugar de solo al salir del campo. */
  commitOnChange?: boolean
}

/** Lista editable de trabajos a realizar: uno por campo, con agregar y quitar. */
export function TrabajosARealizarInput({
  id,
  value,
  onCommit,
  placeholder = "Ej: Cambio de batería",
  commitOnChange = false,
}: TrabajosARealizarInputProps) {
  const [items, setItems] = useState<string[]>(() => {
    const parsed = parseTrabajosARealizar(value)
    return parsed.length > 0 ? parsed : [""]
  })

  // El estado local manda mientras se edita: el valor guardado se lee solo al
  // montar (quien lo usa le pone un `key` estable, no el valor, para no perder el
  // foco ni la fila recién agregada cuando se guarda).
  // Cuánto ocupa el texto guardado si se suma un carácter más en cualquier campo:
  // el tope de 200 es del total (incluidos los saltos de línea).
  const usado = (joinTrabajosARealizar(items) ?? "").length
  const restante = TRABAJO_A_REALIZAR_MAX - usado

  const commit = (next: string[]) => {
    const texto = joinTrabajosARealizar(next)
    if (texto !== joinTrabajosARealizar(parseTrabajosARealizar(value))) onCommit(texto)
  }

  const setItem = (i: number, v: string) => {
    const next = items.map((it, k) => (k === i ? v : it))
    setItems(next)
    if (commitOnChange) commit(next)
  }

  const quitar = (i: number) => {
    const next = items.filter((_, k) => k !== i)
    const final = next.length > 0 ? next : [""]
    setItems(final)
    commit(final)
  }

  const agregar = () => setItems((prev) => [...prev, ""])

  const puedeAgregar = restante > 2 && items[items.length - 1]?.trim() !== ""

  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            id={i === 0 ? id : `${id}-${i}`}
            aria-label={i === 0 ? undefined : `Trabajo ${i + 1}`}
            value={it}
            maxLength={Math.max(it.length + restante, it.length)}
            placeholder={i === 0 ? placeholder : "Otro trabajo"}
            onChange={(e) => setItem(i, e.target.value.replace(/[\r\n]+/g, " "))}
            onBlur={() => commit(items)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                if (puedeAgregar) agregar()
              }
            }}
          />
          {(items.length > 1 || it.trim() !== "") && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label={`Quitar ${it.trim() || "trabajo"}`}
              onClick={() => quitar(i)}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={agregar}
        disabled={!puedeAgregar}
      >
        <Plus className="mr-1 h-4 w-4" />
        Agregar trabajo
      </Button>
    </div>
  )
}
