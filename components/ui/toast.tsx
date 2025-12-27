"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from "lucide-react"
import { cn } from "@/lib/utils"

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-4 pr-8 shadow-lg transition-all",
  {
    variants: {
      variant: {
        default: "border bg-background text-foreground",
        success:
          "border-success/50 bg-success-50 text-success-700 dark:bg-success-100 dark:text-success-foreground",
        destructive:
          "destructive group border-destructive/50 bg-destructive text-destructive-foreground",
        warning:
          "border-warning/50 bg-warning-50 text-warning-700 dark:bg-warning-100 dark:text-warning-foreground",
        info: "border-info/50 bg-info-50 text-info-700 dark:bg-info-100 dark:text-info-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const ToastContext = React.createContext<{
  toasts: ToastProps[]
  addToast: (toast: Omit<ToastProps, "id">) => void
  removeToast: (id: string) => void
} | null>(null)

export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return context
}

interface ToastProps extends VariantProps<typeof toastVariants> {
  id: string
  title?: string
  description?: string
  duration?: number
  action?: React.ReactNode
}

const iconMap = {
  default: null,
  success: CheckCircle,
  destructive: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

function Toast({
  id,
  title,
  description,
  variant = "default",
  action,
}: ToastProps) {
  const { removeToast } = useToast()
  const Icon = iconMap[variant || "default"]

  return (
    <div className={cn(toastVariants({ variant }))}>
      <div className="flex items-start gap-3">
        {Icon && <Icon className="h-5 w-5 shrink-0 mt-0.5" />}
        <div className="grid gap-1">
          {title && <div className="text-sm font-semibold">{title}</div>}
          {description && (
            <div className="text-sm opacity-90">{description}</div>
          )}
        </div>
      </div>
      {action}
      <button
        onClick={() => removeToast(id)}
        className="absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100"
      >
        <X className="h-4 w-4" />
        <span className="sr-only">Cerrar</span>
      </button>
    </div>
  )
}

function ToastViewport({ className }: { className?: string }) {
  const { toasts } = useToast()

  return (
    <div
      className={cn(
        "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
        className
      )}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="mb-2 animate-in slide-in-from-top-full sm:slide-in-from-bottom-full"
        >
          <Toast {...toast} />
        </div>
      ))}
    </div>
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastProps[]>([])

  const addToast = React.useCallback(
    (toast: Omit<ToastProps, "id">) => {
      const id = Math.random().toString(36).substring(2, 9)
      const newToast = { ...toast, id }
      setToasts((prev) => [...prev, newToast])

      // Auto remove after duration (default 5 seconds)
      const duration = toast.duration ?? 5000
      if (duration > 0) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id))
        }, duration)
      }
    },
    []
  )

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastViewport />
    </ToastContext.Provider>
  )
}

// Helper function for quick toasts
export function toast(props: Omit<ToastProps, "id">) {
  // This will only work if called from within the ToastProvider
  // For a more robust solution, consider using a global state management
  console.warn("Use useToast().addToast() instead for proper toast functionality")
}

export { Toast, ToastViewport, toastVariants }
