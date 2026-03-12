"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { CheckCheck, Bell, Loader2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { UserNotification } from "@/types/database"
import {
  ClipboardList,
  Receipt,
  Shield,
  Clock,
  Package,
  AlertTriangle,
  Megaphone,
} from "lucide-react"

function getNotificationIcon(type: string) {
  switch (type) {
    case "CAMBIO_ESTADO":
      return <ClipboardList className="h-4 w-4 text-blue-500" />
    case "PRESUPUESTO_DEFINIDO":
      return <Receipt className="h-4 w-4 text-green-500" />
    case "GARANTIA_CREADA":
      return <Shield className="h-4 w-4 text-purple-500" />
    case "RECORDATORIO_RETIRO":
      return <Clock className="h-4 w-4 text-orange-500" />
    case "ORDEN_ASIGNADA":
      return <ClipboardList className="h-4 w-4 text-cyan-500" />
    case "INVENTARIO_BAJO":
      return <Package className="h-4 w-4 text-red-500" />
    case "NUEVO_RECLAMO":
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />
    case "BROADCAST":
      return <Megaphone className="h-4 w-4 text-primary" />
    default:
      return <Bell className="h-4 w-4 text-muted-foreground" />
  }
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diff = Math.floor((now - date) / 1000)

  if (diff < 60) return "ahora"
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`
  if (diff < 604800) return `hace ${Math.floor(diff / 86400)}d`
  return new Date(dateStr).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
  })
}

function NotificationItem({
  notification,
  onRead,
  onDismiss,
}: {
  notification: UserNotification
  onRead: (id: string, actionUrl?: string | null) => void
  onDismiss: (id: string) => void
}) {
  const isUnread = !notification.read_at

  return (
    <div
      className={cn(
        "group relative w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50",
        isUnread && "bg-accent/30"
      )}
    >
      <button
        onClick={() => onRead(notification.id, notification.action_url)}
        className="flex items-start gap-3 flex-1 min-w-0"
      >
        <div className="mt-0.5 shrink-0">
          {getNotificationIcon(notification.type)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={cn(
              "text-sm truncate",
              isUnread ? "font-semibold" : "font-medium text-muted-foreground"
            )}>
              {notification.title}
            </p>
            {isUnread && (
              <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
            )}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
            {notification.body}
          </p>
          <p className="text-[11px] text-muted-foreground/70 mt-1">
            {timeAgo(notification.created_at)}
          </p>
        </div>
      </button>
      {/* Boton dismiss */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDismiss(notification.id)
        }}
        className="absolute top-2 right-2 h-5 w-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent text-muted-foreground hover:text-foreground"
        aria-label="Descartar notificacion"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

interface NotificationPanelProps {
  notifications: UserNotification[]
  unreadCount: number
  isLoading: boolean
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  dismiss: (id: string) => void
  onNavigate?: () => void
}

export function NotificationPanel({
  notifications,
  unreadCount,
  isLoading,
  markAsRead,
  markAllAsRead,
  dismiss,
  onNavigate,
}: NotificationPanelProps) {
  const router = useRouter()

  const handleRead = (id: string, actionUrl?: string | null) => {
    markAsRead(id)
    if (actionUrl) {
      onNavigate?.()
      router.push(actionUrl)
    }
  }

  return (
    <div className="flex flex-col max-h-[70vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">Notificaciones</h3>
          {unreadCount > 0 && (
            <span className="text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
              {unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground"
            onClick={markAllAsRead}
          >
            <CheckCheck className="h-3.5 w-3.5 mr-1" />
            Marcar todas
          </Button>
        )}
      </div>

      {/* List */}
      <div className="overflow-y-auto flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Bell className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">Sin notificaciones</p>
          </div>
        ) : (
          <div className="divide-y">
            {notifications.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                onRead={handleRead}
                onDismiss={dismiss}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
