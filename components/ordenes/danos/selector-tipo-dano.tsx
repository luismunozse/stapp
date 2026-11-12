"use client"

import { useEffect, useState } from "react"
import { Textarea } from "@/components/ui/textarea"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog"
import { TIPOS_DANO, TIPO_DANO_META, type TipoDano } from "@/lib/ordenes/danos"
import { cn } from "@/lib/utils"

interface Props {
  open: boolean
  onElegir: (tipo: TipoDano, nota: string | null) => void
  onCerrar: () => void
}

/** Hoja inferior en móvil / diálogo en desktop: un toque en el tipo agrega el daño. */
export function SelectorTipoDano({ open, onElegir, onCerrar }: Props) {
  const [nota, setNota] = useState("")

  useEffect(() => {
    if (open) setNota("")
  }, [open])

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && onCerrar()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>¿Qué daño es?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Tocá el tipo para marcarlo. La nota es opcional.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <Textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          maxLength={200}
          rows={2}
          placeholder="Nota (opcional): ej. pantalla, esquina superior"
          aria-label="Nota del daño"
        />
        <div className="grid grid-cols-2 gap-2">
          {TIPOS_DANO.map((tipo) => {
            const { label, icon: Icon, colorClass } = TIPO_DANO_META[tipo]
            return (
              <button
                key={tipo}
                type="button"
                onClick={() => onElegir(tipo, nota.trim() || null)}
                className="flex min-h-11 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className={cn("h-4 w-4 shrink-0", colorClass)} aria-hidden="true" />
                {label}
              </button>
            )
          })}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
