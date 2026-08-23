"use client"

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { AlertDialogCustom } from "@/components/ui/alert-dialog-custom"

type ConfirmVariant = "danger" | "warning" | "info" | "success"
type AlertVariant = "error" | "warning" | "info" | "success"

interface ConfirmOptions {
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  variant?: ConfirmVariant
}

interface AlertOptions {
  title: string
  description: string
  buttonText?: string
  variant?: AlertVariant
}

interface ModalContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  alert: (options: AlertOptions) => Promise<void>
  showSuccess: (message: string) => Promise<void>
  showError: (message: string) => Promise<void>
  showWarning: (message: string) => Promise<void>
  showInfo: (message: string) => Promise<void>
}

const ModalContext = createContext<ModalContextType | undefined>(undefined)

export function ModalProvider({ children }: { children: ReactNode }) {
  // Confirm dialog state
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions>({
    title: "",
    description: "",
  })
  /** En una ref y no en estado: `confirm` tiene que poder leer al resolver
   *  pendiente en el mismo tick en que llega el siguiente, y un estado ahí se
   *  lee una render tarde. */
  const confirmResolveRef = useRef<((value: boolean) => void) | null>(null)
  const [confirmLoading, setConfirmLoading] = useState(false)

  // Alert dialog state
  const [alertOpen, setAlertOpen] = useState(false)
  const [alertOptions, setAlertOptions] = useState<AlertOptions>({
    title: "",
    description: "",
  })
  const [alertResolve, setAlertResolve] = useState<(() => void) | null>(null)

  /** Contesta la pregunta pendiente, si hay, y la da por cerrada. Una sola vez:
   *  la ref se limpia antes de resolver. */
  const settleConfirm = useCallback((value: boolean) => {
    const resolve = confirmResolveRef.current
    confirmResolveRef.current = null
    resolve?.(value)
  }, [])

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      // Este provider tiene UN diálogo y UN resolver, así que una pregunta nueva
      // reemplaza a la anterior en el lugar. Lo que no puede hacer es
      // abandonarla: sin esto, la promesa de la primera no se resolvía nunca y
      // el `await` de quien preguntó quedaba colgado para siempre —en silencio,
      // sin error y sin nada en pantalla—. Pasa cada vez que un confirm sale de
      // un callback asíncrono y cae arriba de un diálogo ya abierto.
      //
      // Se contesta `false`, que es exactamente lo que ya devuelven ESC y el
      // click en el overlay: desde el punto de vista de quien preguntó, su
      // diálogo desapareció de la pantalla sin que nadie lo aceptara. Encolar
      // sería más fiel, pero le apila diálogos a un operador que ya perdió el
      // contexto de la primera pregunta.
      settleConfirm(false)
      confirmResolveRef.current = resolve
      setConfirmOptions(options)
      setConfirmOpen(true)
    })
  }, [settleConfirm])

  const handleConfirm = useCallback(() => {
    settleConfirm(true)
    setConfirmOpen(false)
    setConfirmLoading(false)
  }, [settleConfirm])

  const handleConfirmCancel = useCallback(() => {
    settleConfirm(false)
    setConfirmOpen(false)
    setConfirmLoading(false)
  }, [settleConfirm])

  const alert = useCallback((options: AlertOptions): Promise<void> => {
    return new Promise((resolve) => {
      setAlertOptions(options)
      setAlertResolve(() => resolve)
      setAlertOpen(true)
    })
  }, [])

  const handleAlertClose = useCallback((open: boolean) => {
    if (!open) {
      alertResolve?.()
      setAlertOpen(false)
    }
  }, [alertResolve])

  // Shorthand methods
  const showSuccess = useCallback(
    (message: string) =>
      alert({
        title: "Éxito",
        description: message,
        variant: "success",
      }),
    [alert]
  )

  const showError = useCallback(
    (message: string) =>
      alert({
        title: "Error",
        description: message,
        variant: "error",
      }),
    [alert]
  )

  const showWarning = useCallback(
    (message: string) =>
      alert({
        title: "Advertencia",
        description: message,
        variant: "warning",
      }),
    [alert]
  )

  const showInfo = useCallback(
    (message: string) =>
      alert({
        title: "Información",
        description: message,
        variant: "info",
      }),
    [alert]
  )

  return (
    <ModalContext.Provider
      value={{ confirm, alert, showSuccess, showError, showWarning, showInfo }}
    >
      {children}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) handleConfirmCancel()
        }}
        title={confirmOptions.title}
        description={confirmOptions.description}
        confirmText={confirmOptions.confirmText}
        cancelText={confirmOptions.cancelText}
        variant={confirmOptions.variant}
        loading={confirmLoading}
        onConfirm={handleConfirm}
        onCancel={handleConfirmCancel}
      />

      <AlertDialogCustom
        open={alertOpen}
        onOpenChange={handleAlertClose}
        title={alertOptions.title}
        description={alertOptions.description}
        buttonText={alertOptions.buttonText}
        variant={alertOptions.variant}
      />
    </ModalContext.Provider>
  )
}

export function useModal() {
  const context = useContext(ModalContext)
  if (!context) {
    throw new Error("useModal must be used within a ModalProvider")
  }
  return context
}
