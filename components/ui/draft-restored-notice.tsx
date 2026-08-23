"use client"

import type { ReactNode } from "react"
import { X } from "lucide-react"
import { useModal } from "@/contexts/modal-context"

interface DraftRestoredNoticeProps {
  onDiscard: () => void
  /**
   * Lo que el borrador NO pudo traer de vuelta, cuando lo hay.
   *
   * "Se restauró un borrador" es una promesa completa, y en los formularios que
   * cargan un archivo no lo es: un `File` no se puede serializar y su base64 no
   * entra en la cuota de localStorage, asi que la planilla o la foto se quedan
   * afuera a proposito (ver el limite de persistencia en
   * hooks/use-form-draft.ts). Sin esta linea el operador da por hecho que esta
   * todo y descubre lo que falta recien al guardar. Se pasa solo cuando el
   * borrador restaurado efectivamente traia uno.
   */
  detail?: ReactNode
}

/**
 * Aviso no bloqueante mostrado cuando useFormDraft (hooks/use-form-draft.ts)
 * restaura un borrador guardado automaticamente. Mismo lenguaje visual
 * (dismissible, sin modal) que otros banners del panel -- ver por ejemplo
 * components/subscription/usage-warning-banner.tsx -- pero vive inline en
 * el formulario en vez de fijo en el header.
 */
export function DraftRestoredNotice({ onDiscard, detail }: DraftRestoredNoticeProps) {
  const { confirm } = useModal()

  /**
   * La confirmacion vive ACA y no en cada `discardDraft`: los tres
   * formularios que muestran este aviso (orden, recepcion, cliente) comparten
   * el mismo boton, y dejarla en cada call site es exactamente la forma de que
   * uno se quede sin ella.
   *
   * Un solo click era irreversible: descartar borra la entrada de localStorage
   * (clearDraft) y resetea el formulario, sin nada que deshaga ninguna de las
   * dos cosas. En orden-form.tsx el aviso ademas vive arriba de todo del
   * cuerpo del formulario, pegado al indicador de pasos y al buscador de
   * clientes, o sea justo donde la mano va primero. Cualquier otra accion
   * destructiva de estos formularios ya pasa por useModal.
   */
  const handleDiscard = async () => {
    const confirmado = await confirm({
      title: "Descartar borrador",
      description:
        "Se perderá lo que quedó sin guardar en este formulario. No se puede deshacer.",
      confirmText: "Descartar borrador",
      cancelText: "Seguir editando",
      variant: "danger",
    })
    if (confirmado) onDiscard()
  }

  return (
    <div className="rounded-md border border-blue-200 dark:border-blue-900/40 bg-blue-50/70 dark:bg-blue-950/20 px-3 py-2 text-sm text-blue-900 dark:text-blue-200">
      <div className="flex items-center justify-between gap-3">
        <span>Se restauró un borrador no guardado.</span>
        <button
          type="button"
          onClick={handleDiscard}
          className="inline-flex items-center gap-1 shrink-0 font-medium underline-offset-2 hover:underline"
        >
          <X className="h-3.5 w-3.5" />
          Descartar
        </button>
      </div>
      {detail && <p className="mt-1 text-xs text-blue-800/90 dark:text-blue-300/90">{detail}</p>}
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
