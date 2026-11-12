"use client"

import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"

const NOMBRE_MAX = 100

interface GuardarPlantillaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Sugerencia inicial del nombre (p. ej. el número de la cotización). */
  nombreSugerido?: string
  saving?: boolean
  /** Devuelve `true` si se guardó: el diálogo se cierra solo en ese caso. */
  onSubmit: (nombre: string) => Promise<boolean>
}

/**
 * Pide el nombre de la plantilla al guardar una cotización como plantilla.
 * Reemplaza al `window.prompt` nativo: es bottom-sheet en móvil, valida que el
 * nombre no esté vacío y no se cierra si el guardado falla.
 */
export function GuardarPlantillaDialog({
  open,
  onOpenChange,
  nombreSugerido = "",
  saving = false,
  onSubmit,
}: GuardarPlantillaDialogProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <ResponsiveDialogContent className="sm:max-w-md">
        {/* Radix desmonta el contenido al cerrar: cada apertura arranca con la
            sugerencia, no con lo que quedó escrito la vez anterior. */}
        <PlantillaForm
          nombreSugerido={nombreSugerido}
          saving={saving}
          onCancel={() => onOpenChange(false)}
          onSubmit={async (nombre) => {
            if (await onSubmit(nombre)) onOpenChange(false)
          }}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function PlantillaForm({
  nombreSugerido,
  saving,
  onCancel,
  onSubmit,
}: {
  nombreSugerido: string
  saving: boolean
  onCancel: () => void
  onSubmit: (nombre: string) => Promise<void>
}) {
  const inputId = useId()
  const [nombre, setNombre] = useState(nombreSugerido)
  const limpio = nombre.trim()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!limpio || saving) return
    await onSubmit(limpio)
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <ResponsiveDialogHeader className="pr-8">
        <ResponsiveDialogTitle>Guardar como plantilla</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          Los ítems, las notas, los términos y los descuentos quedan listos para usar en una cotización nueva.
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <div className="grid gap-2">
        <Label htmlFor={inputId}>Nombre de la plantilla</Label>
        <Input
          id={inputId}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          maxLength={NOMBRE_MAX}
          placeholder="Ej.: Cambio de pantalla iPhone"
          autoFocus
          autoComplete="off"
          disabled={saving}
        />
      </div>
      <ResponsiveDialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!limpio || saving}>
          {saving ? "Guardando..." : "Guardar plantilla"}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  )
}
