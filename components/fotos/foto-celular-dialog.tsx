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
  /**
   * Orden existente: las fotos se guardan directo en ella.
   * Sin orden (alta/recepción): las fotos llegan a este diálogo y se entregan
   * por `onFotoRecibida` para que el formulario las sume.
   */
  ordenId?: string
  /** Solo con orden: tipo con el que se guardan las fotos que lleguen. */
  tipo?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Con orden: llegaron fotos nuevas, el padre recarga la galería. */
  onFotos?: () => void
  /** Sin orden: una foto sacada con el celular, lista para el formulario. */
  onFotoRecibida?: (file: File) => void
}

interface Enlace {
  qr: string
  expiresAt: number
}

interface FotoEnTransito {
  id: string
  mime: string
  data: string
}

const INTERVALO_MS = 3000

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

function aArchivo(foto: FotoEnTransito): File {
  const bytes = Uint8Array.from(atob(foto.data), (c) => c.charCodeAt(0))
  const ext = foto.mime.split("/")[1] === "jpeg" ? "jpg" : foto.mime.split("/")[1]
  return new File([bytes], `celular-${foto.id}.${ext}`, { type: foto.mime })
}

/**
 * Muestra un QR con un enlace temporal para sacar fotos con el celular, sin
 * iniciar sesión ahí. Mientras está abierto consulta qué llegó; al cerrarse
 * retira lo que haya quedado en camino y el enlace deja de servir.
 */
export function FotoCelularDialog({
  ordenId,
  tipo,
  open,
  onOpenChange,
  onFotos,
  onFotoRecibida,
}: FotoCelularDialogProps) {
  const [enlace, setEnlace] = useState<Enlace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recibidas, setRecibidas] = useState(0)
  const [restante, setRestante] = useState(0)
  const [vencido, setVencido] = useState(false)
  const [intento, setIntento] = useState(0)
  const onFotosRef = useRef(onFotos)
  const onFotoRecibidaRef = useRef(onFotoRecibida)
  useEffect(() => {
    onFotosRef.current = onFotos
    onFotoRecibidaRef.current = onFotoRecibida
  })

  const base = ordenId ? `/api/ordenes/${ordenId}/fotos/sesion-celular` : "/api/fotos/sesion-celular"

  // Un solo ciclo por apertura: genera el enlace, consulta qué llegó y, al
  // cerrar, termina de retirar lo pendiente antes de revocar. Que sea uno solo
  // garantiza que ninguna foto se entregue dos veces.
  useEffect(() => {
    if (!open) return
    let cerrando = false
    let despertar: (() => void) | null = null
    setEnlace(null)
    setError(null)
    setRecibidas(0)
    setVencido(false)

    const dormir = () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, INTERVALO_MS)
        despertar = () => {
          clearTimeout(timer)
          resolve()
        }
      })

    ;(async () => {
      let sesionId: string
      try {
        const res = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tipo ? { tipo } : {}),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(data?.error || "No se pudo generar el enlace")
        sesionId = data.sesionId
        if (!cerrando) {
          const url = `${window.location.origin}/subir-fotos/${data.token}`
          const qr = await QRCode.toDataURL(url, { width: 480, margin: 1, errorCorrectionLevel: "M" })
          const expiresAt = new Date(data.expiresAt).getTime()
          if (!cerrando) {
            setEnlace({ qr, expiresAt })
            setRestante(expiresAt - Date.now())
          }
        }
      } catch (e) {
        if (!cerrando) setError(e instanceof Error ? e.message : "No se pudo generar el enlace")
        return
      }

      const sesion = `sesion=${encodeURIComponent(sesionId)}`
      let visto = 0
      // Foto ya entregada al formulario: se confirma en la consulta siguiente.
      let confirmar: string | null = null

      for (;;) {
        let data: {
          fotosSubidas: number
          activa: boolean
          foto?: FotoEnTransito | null
        } | null = null
        let perdida = false
        try {
          const res = await fetch(
            `${base}?${sesion}${confirmar ? `&recibida=${encodeURIComponent(confirmar)}` : ""}`
          )
          if (res.ok) {
            data = await res.json()
            confirmar = null
          } else if (res.status === 404) {
            perdida = true
          }
        } catch {
          // Un corte de red no cierra el QR: se reintenta en la próxima vuelta.
        }
        if (perdida) break

        if (data) {
          if (data.fotosSubidas > visto) {
            visto = data.fotosSubidas
            if (!cerrando) setRecibidas(visto)
            onFotosRef.current?.()
          }
          if (data.foto) {
            onFotoRecibidaRef.current?.(aArchivo(data.foto))
            confirmar = data.foto.id
            // Puede haber más en camino: se consulta de nuevo sin esperar.
            continue
          }
          if (!data.activa) {
            if (!cerrando) setVencido(true)
            break
          }
        }
        // Cerrando: se sale cuando ya no queda nada por retirar (o no hay red).
        if (cerrando) break
        await dormir()
      }

      fetch(`${base}?${sesion}`, { method: "DELETE", keepalive: true }).catch(() => {})
    })()

    return () => {
      cerrando = true
      despertar?.()
    }
    // `tipo` se toma al abrir: cambiarlo no regenera el enlace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, base, intento])

  // Cuenta regresiva.
  useEffect(() => {
    if (!open || !enlace || vencido) return
    const reloj = setInterval(() => {
      const ms = enlace.expiresAt - Date.now()
      setRestante(ms)
      if (ms <= 0) setVencido(true)
    }, 1000)
    return () => clearInterval(reloj)
  }, [open, enlace, vencido])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{ordenId ? "Subir fotos desde el celular" : "Sacar fotos con el celular"}</DialogTitle>
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
                alt="Código QR para sacar fotos con el celular"
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
