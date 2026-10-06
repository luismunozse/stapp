"use client"

import { useRef, useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { GRACE_DAYS } from "@/lib/account-deletion/state"
import type { DeletionInfo } from "@/lib/account-deletion/types"
import { ReauthFields, EMPTY_REAUTH, isReauthComplete, toReauthPayload, reauthErrorMessage, type ReauthValue } from "./reauth-fields"
import { cerrarSesionTrasBaja } from "./cerrar-sesion-tras-baja"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  info: DeletionInfo
}

const SUBSCRIPTION_MESSAGE = "No pudimos cancelar tu suscripción, reintentá o escribí a soporte"
const ALREADY_PENDING_MESSAGE = "Este taller ya está en proceso de eliminación."
const FORBIDDEN_MESSAGE = "Esta acción no está permitida para tu usuario."
const NETWORK_MESSAGE = "Error de conexión. Reintentá en unos segundos."
const GENERIC_MESSAGE = "No pudimos eliminar el taller. Reintentá más tarde."
const BACKUP_FAILED_MESSAGE =
  "No pudimos descargar el respaldo. Reintentá, o tildá la casilla si no lo necesitás."

// Targets táctiles de 44px en pantallas coarse (WebView de la APK), igual que el Dialog base.
const TOUCH = "[@media(pointer:coarse)]:h-11"
const TOUCH_INPUT = "[@media(pointer:coarse)]:h-11"

export function EliminarTallerDialog({ open, onOpenChange, info }: Props) {
  const [backupHecho, setBackupHecho] = useState(false)
  const [slug, setSlug] = useState("")
  const [value, setValue] = useState<ReauthValue>(EMPTY_REAUTH)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // El estado llega un render tarde: las refs frenan un segundo clic en el mismo tick.
  const inFlight = useRef(false)
  const downloadInFlight = useRef(false)

  const slugOk = slug.trim().toLowerCase() === info.slug.toLowerCase()
  const reauthOk = isReauthComplete(value, info.hasPassword, info.totpEnabled)
  const canSubmit = !loading && backupHecho && slugOk && reauthOk

  const handleOpenChange = (next: boolean) => {
    if (loading) return
    if (!next) {
      setBackupHecho(false)
      setSlug("")
      setValue(EMPTY_REAUTH)
      setError(null)
    }
    onOpenChange(next)
  }

  // fetch + Blob (no un link): así sabemos si el ZIP terminó de bajar antes de dar el respaldo por hecho.
  const descargarRespaldo = async () => {
    if (downloadInFlight.current) return
    downloadInFlight.current = true
    setDownloading(true)
    setError(null)
    try {
      const res = await fetch("/api/account/export")
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) ?? {}
        const msg = typeof data === "object" && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : null
        setError(msg ?? BACKUP_FAILED_MESSAGE)
        return
      }
      const blob = await res.blob()
      // Import dinámico: csv-export arrastra exceljs y solo lo necesitamos al descargar.
      const { triggerDownload } = await import("@/lib/csv-export")
      await triggerDownload(blob, `respaldo-${info.slug}.zip`)
      setBackupHecho(true)
    } catch {
      setError(BACKUP_FAILED_MESSAGE)
    } finally {
      downloadInFlight.current = false
      setDownloading(false)
    }
  }

  const submit = async () => {
    if (inFlight.current || !backupHecho || !slugOk || !reauthOk) return
    inFlight.current = true
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/account/delete-organization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmSlug: slug, ...toReauthPayload(value, info.hasPassword, info.totpEnabled) }),
      })
      const parsed: unknown = (await res.json().catch(() => null)) ?? {}
      const data: { code?: string; error?: string } = typeof parsed === "object" ? (parsed as { code?: string; error?: string }) : {}
      if (res.ok) {
        // Éxito: dejamos el botón deshabilitado, cerrarSesionTrasBaja siempre redirige.
        toast.success("El taller fue desactivado y la suscripción cancelada")
        await cerrarSesionTrasBaja()
        return
      }
      setError(
        reauthErrorMessage(data) ??
          (res.status === 502
            ? SUBSCRIPTION_MESSAGE
            : res.status === 409
              ? ALREADY_PENDING_MESSAGE
              : res.status === 403
                ? FORBIDDEN_MESSAGE
                : data.error || GENERIC_MESSAGE),
      )
      inFlight.current = false
      setLoading(false)
    } catch {
      setError(NETWORK_MESSAGE)
      inFlight.current = false
      setLoading(false)
    }
  }

  const busy = loading || downloading

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Eliminar el taller</DialogTitle>
          <DialogDescription>
            Se desactiva el acceso de todo el equipo y la suscripción se cancela ahora. A los {GRACE_DAYS} días se borran
            todos los datos de forma definitiva.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">1. Descargá tu respaldo</p>
          <p className="text-sm text-muted-foreground">
            ZIP con clientes, ventas, facturas, notas de crédito, cuenta corriente y comprobantes fiscales. Conservar la
            documentación fiscal es obligación del taller: STApp no la guarda después de los {GRACE_DAYS} días.
          </p>
          <Button type="button" variant="outline" size="sm" className={TOUCH} onClick={descargarRespaldo} disabled={busy}>
            {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Descargar respaldo
          </Button>
          <div className="flex items-center gap-2 pt-1 [@media(pointer:coarse)]:min-h-11">
            <input
              id="eliminar-taller-backup"
              type="checkbox"
              checked={backupHecho}
              onChange={(e) => setBackupHecho(e.target.checked)}
              disabled={loading}
              className="h-4 w-4 [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-6"
            />
            <Label htmlFor="eliminar-taller-backup" className="font-normal">
              Descargué mi respaldo o no lo necesito
            </Label>
          </div>
        </section>

        <section className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">2. Confirmá</p>
          <div className="space-y-1.5">
            <Label htmlFor="eliminar-taller-slug">
              Escribí el subdominio del taller (<span className="font-mono">{info.slug}</span>)
            </Label>
            <Input
              id="eliminar-taller-slug"
              className={TOUCH_INPUT}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              disabled={loading}
            />
          </div>
          <ReauthFields
            idPrefix="eliminar-taller"
            hasPassword={info.hasPassword}
            totpEnabled={info.totpEnabled}
            value={value}
            onChange={setValue}
            disabled={loading}
          />
        </section>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className={TOUCH} onClick={() => handleOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="destructive" className={TOUCH} onClick={submit} disabled={!canSubmit}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Eliminar el taller
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
