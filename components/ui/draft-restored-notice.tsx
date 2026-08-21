"use client"

import { X } from "lucide-react"

interface DraftRestoredNoticeProps {
  onDiscard: () => void
}

/**
 * Aviso no bloqueante mostrado cuando useFormDraft (hooks/use-form-draft.ts)
 * restaura un borrador guardado automaticamente. Mismo lenguaje visual
 * (dismissible, sin modal) que otros banners del panel -- ver por ejemplo
 * components/subscription/usage-warning-banner.tsx -- pero vive inline en
 * el formulario en vez de fijo en el header.
 */
export function DraftRestoredNotice({ onDiscard }: DraftRestoredNoticeProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-blue-200 dark:border-blue-900/40 bg-blue-50/70 dark:bg-blue-950/20 px-3 py-2 text-sm text-blue-900 dark:text-blue-200">
      <span>Se restauró un borrador no guardado.</span>
      <button
        type="button"
        onClick={onDiscard}
        className="inline-flex items-center gap-1 shrink-0 font-medium underline-offset-2 hover:underline"
      >
        <X className="h-3.5 w-3.5" />
        Descartar
      </button>
    </div>
  )
}

/**
 * Aviso de conflicto: mientras el formulario tenia trabajo sin guardar (lo que
 * el operador venia escribiendo, o un borrador restaurado que sigue en
 * pantalla), otra persona guardo el mismo registro.
 *
 * No se descarta nada — perder el trabajo en silencio es peor que el conflicto,
 * y descartar el guardado ajeno sin decirlo es peor todavia. El submit de estos
 * formularios manda el registro entero, asi que guardar ahora reemplaza lo que
 * guardo la otra persona: la decision es de quien esta mirando la pantalla y
 * este aviso es lo que se la da. Ver `recordChangedWhileEditing` en
 * hooks/use-form-draft.ts.
 */
export function RecordChangedNotice() {
  return (
    <div className="rounded-md border border-amber-200 dark:border-amber-900/40 bg-amber-50/70 dark:bg-amber-950/20 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
      Otro usuario guardó esta ficha mientras estaba abierta. Si guarda ahora, sus cambios
      reemplazarán los de esa persona.
    </div>
  )
}
