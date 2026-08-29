"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Loader2, MessageCircle, RefreshCw } from "lucide-react"

type State = "open" | "connecting" | "close" | "qr" | "unknown"

/** Cada cuánto consultamos el estado de vinculación. */
const POLL_MS = 3_000
/** Vida útil que le damos al QR en pantalla antes de pedir el siguiente. */
const QR_TTL_MS = 15_000

export function SucursalWhatsAppCard({ sucursalId }: { sucursalId: string }) {
  const [state, setState] = useState<State>("unknown")
  const [qr, setQr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ultimoQrRef = useRef(0)

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  // `conQr` va aparte del estado porque `/instance/connect` es más caro que
  // `/instance/connectionState`, y el estado se pollea mucho más seguido que
  // lo que tarda el QR en vencer.
  const poll = useCallback(async (conQr = false) => {
    try {
      const res = await fetch(
        `/api/sucursales/${sucursalId}/whatsapp/qr${conQr ? "?refresh=1" : ""}`,
        { method: "GET" }
      )
      if (!res.ok) return
      const d = await res.json()
      setState(d.state)
      if (d.state === "open") { setQr(null); stopPoll(); return }
      if (conQr && d.qrBase64) setQr(d.qrBase64)
    } catch {
      // Error de red al pollear: se reintenta en el próximo ciclo
    }
  }, [sucursalId, stopPoll])

  // El QR del server vence solo; hay que ir a buscar el vigente en vez de
  // dejar en pantalla uno que el teléfono ya va a rechazar.
  const arrancarPoll = useCallback(() => {
    stopPoll()
    pollRef.current = setInterval(() => {
      const toca = Date.now() - ultimoQrRef.current >= QR_TTL_MS
      if (toca) ultimoQrRef.current = Date.now()
      poll(toca)
    }, POLL_MS)
  }, [poll, stopPoll])

  const connect = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/sucursales/${sucursalId}/whatsapp/connect`, { method: "POST" })
      const d = await res.json()
      if (!res.ok) { setError(d.error || "Error al conectar"); return }
      setState(d.state)
      setQr(d.qrBase64 || null)
      ultimoQrRef.current = Date.now()
      if (d.state !== "open") {
        arrancarPoll()
      }
    } catch {
      setError("Error de conexión")
    } finally {
      setLoading(false)
    }
  }, [sucursalId, arrancarPoll])

  const logout = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/sucursales/${sucursalId}/whatsapp/logout`, { method: "POST" })
      const d = await res.json()
      if (!res.ok || !d.success) { setError(d.error || "No se pudo desconectar"); return }
      setState("close"); setQr(null); stopPoll()
    } catch {
      setError("Error de conexión")
    } finally {
      setLoading(false)
    }
  }, [sucursalId, stopPoll])

  useEffect(() => {
    // Estado inicial
    poll()
    return () => stopPoll()
  }, [poll, stopPoll])

  const connected = state === "open"

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MessageCircle className="h-4 w-4 text-green-600" /> WhatsApp de la sucursal
        </div>
        <Badge variant={connected ? "default" : "secondary"} className={connected ? "bg-green-600" : ""}>
          {connected ? "Conectado" : state === "connecting" || state === "qr" ? "Conectando…" : "Desconectado"}
        </Badge>
      </div>

      {qr && !connected && (
        <div className="flex flex-col items-center gap-2">
          <img src={qr} alt="QR de WhatsApp" className="w-48 h-48" />
          <p className="text-xs text-muted-foreground text-center">
            Escaneá este QR desde WhatsApp → Dispositivos vinculados, con el teléfono de la sucursal.
          </p>
          <Button variant="ghost" size="sm" onClick={() => poll()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Ya lo escaneé
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        {connected ? (
          <Button variant="outline" size="sm" onClick={logout} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Desconectar
          </Button>
        ) : (
          <Button size="sm" onClick={connect} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Conectar WhatsApp
          </Button>
        )}
      </div>
    </div>
  )
}
