"use client"

import { useEffect, useRef, useState } from "react"
import QRCode from "qrcode"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AlertCircle, Loader2, RefreshCw } from "lucide-react"

interface FotoCelularDialogProps {
  ordenId: string
  /** Tipo con el que se guardan las fotos que lleguen por este enlace. */
  tipo: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Llegaron fotos nuevas desde el celular: el padre recarga la galería. */
  onFotos: () => void
}

interface Enlace {
  sesionId: string
  qr: string
  expiresAt: number
}

const INTERVALO_MS = 3000

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/**
 * Muestra un QR con un enlace temporal para subir fotos a la orden desde el
 * celular, sin iniciar sesión ahí. Mientras está abierto consulta cuántas
 * llegaron; al cerrarse, el enlace deja de servir.
 */
export function FotoCelularDialog({ ordenId, tipo, open, onOpenChange, onFotos }: FotoCelularDialogProps) {
  const [enlace, setEnlace] = useState<Enlace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recibidas, setRecibidas] = useState(0)
  const [restante, setRestante] = useState(0)
  const [vencido, setVencido] = useState(false)
  const [intento, setIntento] = useState(0)
  const onFotosRef = useRef(onFotos)
  useEffect(() => {
    onFotosRef.current = onFotos
  })

  const base = `/api/ordenes/${ordenId}/fotos/sesion-celular`

  // Genera el enlace al abrir (y al pedir uno nuevo); lo revoca al cerrar.
  useEffect(() => {
    if (!open) return
    let vigente = true
    let sesionId: string | null = null
    setEnlace(null)
    setError(null)
    setRecibidas(0)
    setVencido(false)

    const revocar = (id: string) =>
      fetch(`${base}?sesion=${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true }).catch(() => {})

    ;(async () => {
      try {
        const res = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipo }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(data?.error || "No se pudo generar el enlace")
        sesionId = data.sesionId
        if (!vigente) {
          revocar(data.sesionId)
          return
        }
        const url = `${window.location.origin}/subir-fotos/${data.token}`
        const qr = await QRCode.toDataURL(url, { width: 480, margin: 1, errorCorrectionLevel: "M" })
        if (!vigente) return
        const expiresAt = new Date(data.expiresAt).getTime()
        setEnlace({ sesionId: data.sesionId, qr, expiresAt })
        setRestante(expiresAt - Date.now())
      } catch (e) {
        if (vigente) setError(e instanceof Error ? e.message : "No se pudo generar el enlace")
      }
    })()

    return () => {
      vigente = false
      if (sesionId) revocar(sesionId)
    }
    // `tipo` se toma al abrir: cambiarlo no regenera el enlace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, base, intento])

  // Cuenta regresiva + consulta de fotos recibidas mientras el enlace vive.
  useEffect(() => {
    if (!open || !enlace || vencido) return
    let visto = 0

    const reloj = setInterval(() => {
      const ms = enlace.expiresAt - Date.now()
      setRestante(ms)
      if (ms <= 0) setVencido(true)
    }, 1000)

    const consultar = async () => {
      try {
        const res = await fetch(`${base}?sesion=${encodeURIComponent(enlace.sesionId)}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.fotosSubidas > visto) {
          visto = data.fotosSubidas
          setRecibidas(data.fotosSubidas)
          onFotosRef.current()
        }
        if (!data.activa) setVencido(true)
      } catch {
        // Un corte de red no cierra el QR: se reintenta en la próxima vuelta.
      }
    }
    const sondeo = setInterval(consultar, INTERVALO_MS)

    return () => {
      clearInterval(reloj)
      clearInterval(sondeo)
    }
  }, [open, enlace, vencido, base])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Subir fotos desde el celular</DialogTitle>
          <DialogDescription>
            Escaneá el código con la cámara del celular. No hace falta iniciar sesión.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2 text-center">
          {error ? (
            <>
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm">{error}</p>
              <Button type="button" variant="outline" onClick={() => setIntento((n) => n + 1)}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Reintentar
              </Button>
            </>
          ) : !enlace ? (
            <div className="flex h-60 items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Generando código...
            </div>
          ) : vencido ? (
            <>
              <p className="text-sm text-muted-foreground">
                El código venció{recibidas > 0 ? ` (${recibidas === 1 ? "llegó 1 foto" : `llegaron ${recibidas} fotos`})` : ""}.
              </p>
              <Button type="button" onClick={() => setIntento((n) => n + 1)}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Generar otro código
              </Button>
            </>
          ) : (
            <>
              {/* Fondo blanco fijo: el QR tiene que leerse igual en tema oscuro. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={enlace.qr}
                alt="Código QR para subir fotos desde el celular"
                className="h-60 w-60 rounded-lg border bg-white p-2"
              />
              <p className="text-sm font-medium" aria-live="polite">
                {recibidas === 0
                  ? "Esperando fotos..."
                  : recibidas === 1
                    ? "Llegó 1 foto"
                    : `Llegaron ${recibidas} fotos`}
              </p>
              <p className="text-xs text-muted-foreground">
                Vence en {mmss(restante)}. Dejá esta ventana abierta mientras sacás las fotos: al
                cerrarla, el código deja de funcionar.
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
