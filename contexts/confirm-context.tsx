"use client"

import { createContext, useContext, useState, useCallback, ReactNode } from "react"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

type ConfirmVariant = "danger" | "warning" | "info" | "success"

interface ConfirmOptions {
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  variant?: ConfirmVariant
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  alert: (options: Omit<ConfirmOptions, "cancelText">) => Promise<void>
}

const ConfirmContext = createContext<ConfirmContextType | null>(null)

interface ConfirmState extends ConfirmOptions {
  open: boolean
  resolve: ((value: boolean) => void) | null
  isAlert: boolean
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState>({
    open: false,
    title: "",
    description: "",
    confirmText: "Confirmar",
    cancelText: "Cancelar",
    variant: "danger",
    resolve: null,
    isAlert: false,
  })
  const [loading, setLoading] = useState(false)

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        open: true,
        title: options.title,
        description: options.description,
        confirmText: options.confirmText || "Confirmar",
        cancelText: options.cancelText || "Cancelar",
        variant: options.variant || "danger",
        resolve,
        isAlert: false,
      })
    })
  }, [])

  const alert = useCallback((options: Omit<ConfirmOptions, "cancelText">): Promise<void> => {
    return new Promise((resolve) => {
      setState({
        open: true,
        title: options.title,
        description: options.description,
        confirmText: options.confirmText || "Aceptar",
        cancelText: "",
        variant: options.variant || "info",
        resolve: () => resolve(),
        isAlert: true,
      })
    })
  }, [])

  const handleConfirm = useCallback(() => {
    state.resolve?.(true)
    setState((prev) => ({ ...prev, open: false, resolve: null }))
  }, [state.resolve])

  const handleCancel = useCallback(() => {
    state.resolve?.(false)
    setState((prev) => ({ ...prev, open: false, resolve: null }))
  }, [state.resolve])

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      state.resolve?.(false)
      setState((prev) => ({ ...prev, open: false, resolve: null }))
    }
  }, [state.resolve])

  return (
    <ConfirmContext.Provider value={{ confirm, alert }}>
      {children}
      <ConfirmDialog
        open={state.open}
        onOpenChange={handleOpenChange}
        title={state.title}
        description={state.description}
        confirmText={state.confirmText}
        cancelText={state.isAlert ? undefined : state.cancelText}
        variant={state.variant}
        loading={loading}
        onConfirm={handleConfirm}
        onCancel={state.isAlert ? undefined : handleCancel}
      />
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const context = useContext(ConfirmContext)
  if (!context) {
    throw new Error("useConfirm must be used within a ConfirmProvider")
  }
  return context
}

// Shortcuts para casos comunes
export function useConfirmDelete() {
  const { confirm } = useConfirm()

  return useCallback(
    (itemName: string = "este elemento") =>
      confirm({
        title: "Eliminar",
        description: `¿Estás seguro de que deseas eliminar ${itemName}? Esta acción no se puede deshacer.`,
        confirmText: "Eliminar",
        cancelText: "Cancelar",
        variant: "danger",
      }),
    [confirm]
  )
}

export function useConfirmCancel() {
  const { confirm } = useConfirm()

  return useCallback(
    (actionName: string = "esta acción") =>
      confirm({
        title: "Cancelar",
        description: `¿Estás seguro de que deseas cancelar ${actionName}? Los cambios no guardados se perderán.`,
        confirmText: "Sí, cancelar",
        cancelText: "No, continuar",
        variant: "warning",
      }),
    [confirm]
  )
}
