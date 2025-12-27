"use client"

import { createContext, useContext, useState, useCallback, ReactNode } from "react"
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
  const [confirmResolve, setConfirmResolve] = useState<((value: boolean) => void) | null>(null)
  const [confirmLoading, setConfirmLoading] = useState(false)

  // Alert dialog state
  const [alertOpen, setAlertOpen] = useState(false)
  const [alertOptions, setAlertOptions] = useState<AlertOptions>({
    title: "",
    description: "",
  })
  const [alertResolve, setAlertResolve] = useState<(() => void) | null>(null)

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmOptions(options)
      setConfirmResolve(() => resolve)
      setConfirmOpen(true)
    })
  }, [])

  const handleConfirm = useCallback(() => {
    confirmResolve?.(true)
    setConfirmOpen(false)
    setConfirmLoading(false)
  }, [confirmResolve])

  const handleConfirmCancel = useCallback(() => {
    confirmResolve?.(false)
    setConfirmOpen(false)
    setConfirmLoading(false)
  }, [confirmResolve])

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
