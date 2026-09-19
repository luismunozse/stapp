"use client"

import { useEffect, useRef, useState } from "react"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Smartphone, Loader2 } from "lucide-react"
import { useTerminologia } from "@/contexts/currency-context"

export interface EquipoEditable {
  dispositivo: string
  marca: string
  color: string
  imei: string
}

interface EditarEquipoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  equipo: EquipoEditable
  /** Persiste los campos que cambiaron. Devuelve true si se guardó. */
  onSave: (cambios: Partial<EquipoEditable>) => Promise<boolean>
}

/**
 * Corrección de los datos del equipo ya cargado (modelo, marca, color, número
 * de serie). El alta los pide una sola vez y después el detalle los mostraba
 * como texto muerto: un modelo mal tipeado o una marca que se autocompletó
 * sola obligaban a dar de baja la orden y cargarla de nuevo.
 *
 * El TIPO de equipo no se edita acá: el código de la orden sale del contador
 * de su tipo (PC023) y cambiarlo dejaría el comprobante ya impreso apuntando
 * a otro tipo.
 */
export function EditarEquipoDialog({ open, onOpenChange, equipo, onSave }: EditarEquipoDialogProps) {
  const term = useTerminologia()
  const [draft, setDraft] = useState<EquipoEditable>(equipo)
  const [saving, setSaving] = useState(false)

  /** Si el diálogo estaba abierto en el render anterior. Lo que se necesita es
   *  la transición cerrado → abierto, no "está abierto": el detalle refresca la
   *  orden sola cada 15s (useVisibilityPolling) y eso cambia la identidad de
   *  `equipo` en cada vuelta. Reaccionar a la prop sin más le borraba al
   *  operador lo que estaba tipeando, a mitad de palabra y sin tocar nada. */
  const estabaAbierto = useRef(false)

  // Al abrir se parte SIEMPRE de lo guardado: si el diálogo se cerró con
  // "Cancelar" y se vuelve a abrir, lo tipeado y descartado no puede seguir ahí.
  useEffect(() => {
    if (open && !estabaAbierto.current) setDraft(equipo)
    estabaAbierto.current = open
  }, [open, equipo])

  const handleGuardar = async () => {
    const limpio: EquipoEditable = {
      dispositivo: draft.dispositivo.trim(),
      marca: draft.marca.trim(),
      color: draft.color.trim(),
      imei: draft.imei.trim(),
    }
    if (!limpio.dispositivo) return

    // Solo viaja lo que cambió: un PUT con los cuatro campos siempre presentes
    // ensucia la auditoría con "cambios" que no lo son.
    const cambios: Partial<EquipoEditable> = {}
    for (const key of Object.keys(limpio) as Array<keyof EquipoEditable>) {
      if (limpio[key] !== (equipo[key] || "").trim()) cambios[key] = limpio[key]
    }
    if (Object.keys(cambios).length === 0) {
      onOpenChange(false)
      return
    }

    setSaving(true)
    try {
      const ok = await onSave(cambios)
      if (ok) onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Editar {term("equipo").toLowerCase()}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Corregí los datos cargados en la recepción. El tipo de {term("equipo").toLowerCase()} no
            se puede cambiar: el código de la orden sale de su numerador.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="editar-dispositivo">Modelo / descripción *</Label>
            <Input
              id="editar-dispositivo"
              value={draft.dispositivo}
              onChange={(e) => setDraft((prev) => ({ ...prev, dispositivo: e.target.value }))}
              placeholder="Modelo o descripcion del equipo"
              disabled={saving}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="editar-marca">Marca</Label>
              <Input
                id="editar-marca"
                value={draft.marca}
                onChange={(e) => setDraft((prev) => ({ ...prev, marca: e.target.value }))}
                placeholder="Marca"
                disabled={saving}
              />
            </div>
            <div>
              <Label htmlFor="editar-color">Color</Label>
              <Input
                id="editar-color"
                value={draft.color}
                onChange={(e) => setDraft((prev) => ({ ...prev, color: e.target.value }))}
                placeholder="Color"
                disabled={saving}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="editar-imei">{term("serie")}</Label>
            <Input
              id="editar-imei"
              value={draft.imei}
              onChange={(e) => setDraft((prev) => ({ ...prev, imei: e.target.value }))}
              placeholder="S/N del equipo"
              disabled={saving}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleGuardar} disabled={saving || !draft.dispositivo.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
