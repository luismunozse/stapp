"use client"

import { useState } from "react"
import { Bell, BellOff, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { useWebPush } from "@/hooks/use-web-push"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { isNativePlatform } from "@/lib/capacitor"

/**
 * Notification settings card — enable/disable browser Web Push, send a test.
 *
 * In Capacitor native, this UI is hidden since `usePushNotifications`
 * auto-registers on session restore and there's no toggle exposed at OS
 * level beyond the device's permission dialog.
 */
export function PushSettings() {
  const { supported, permission, subscribed, loading, error, subscribe, unsubscribe } = useWebPush()
  const [testing, setTesting] = useState(false)

  // Native uses platform OS settings; this card is browser-only.
  if (typeof window !== "undefined" && isNativePlatform()) return null

  const handleToggle = async () => {
    if (subscribed) {
      const ok = await unsubscribe()
      if (ok) toast.success("Notificaciones desactivadas")
    } else {
      const ok = await subscribe()
      if (ok) toast.success("Notificaciones activadas")
      else if (error) toast.error(error)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      const res = await fetch("/api/push/test", { method: "POST" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error || "No se pudo enviar la prueba")
        return
      }
      toast.success("Notificación de prueba enviada")
    } catch {
      toast.error("Error de red")
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Notificaciones push
        </CardTitle>
        <CardDescription>
          Recibí avisos en este dispositivo cuando hay novedades en órdenes,
          cobros y mensajes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!supported && (
          <Banner variant="warning" icon={AlertCircle}>
            Este navegador no soporta Web Push. Probá Chrome, Edge o Firefox
            en versiones recientes, o instalá la app Android.
          </Banner>
        )}

        {supported && permission === "denied" && (
          <Banner variant="error" icon={AlertCircle}>
            Permiso bloqueado. Habilitá las notificaciones para este sitio
            desde los ajustes del navegador y recargá la página.
          </Banner>
        )}

        {supported && subscribed && (
          <Banner variant="success" icon={CheckCircle2}>
            Notificaciones activas en este dispositivo.
          </Banner>
        )}

        {supported && error && permission !== "denied" && (
          <Banner variant="error" icon={AlertCircle}>{error}</Banner>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            onClick={handleToggle}
            disabled={!supported || loading || permission === "denied"}
            variant={subscribed ? "outline" : "default"}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : subscribed ? (
              <BellOff className="h-4 w-4 mr-2" />
            ) : (
              <Bell className="h-4 w-4 mr-2" />
            )}
            {subscribed ? "Desactivar" : "Activar"}
          </Button>

          {subscribed && (
            <Button onClick={handleTest} variant="secondary" disabled={testing}>
              {testing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Probar
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground pt-2">
          La activación es por dispositivo. Si cambiás de teléfono o
          navegador tenés que volver a activarlas allí.
        </p>
      </CardContent>
    </Card>
  )
}

function Banner({
  variant,
  icon: Icon,
  children,
}: {
  variant: "warning" | "error" | "success"
  icon: typeof AlertCircle
  children: React.ReactNode
}) {
  const styles =
    variant === "error"
      ? "bg-destructive/10 text-destructive border-destructive/30"
      : variant === "warning"
        ? "bg-warning-50 text-warning-700 border-warning-200 dark:bg-warning-100 dark:text-warning-200"
        : "bg-success-50 text-success-700 border-success-200 dark:bg-success-100 dark:text-success-200"
  return (
    <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${styles}`}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
