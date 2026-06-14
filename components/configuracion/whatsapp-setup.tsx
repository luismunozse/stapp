"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, MessageCircle, CheckCircle2, RefreshCw } from "lucide-react"

type Status = "loading" | "disconnected" | "pairing" | "connected"

export function WhatsAppSetup() {
  const [status, setStatus] = useState<Status>("loading")
  const [qr, setQr] = useState<string | null>(null)
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/config")
      const data = await res.json().catch(() => ({}))
      if (data?.isVerified || data?.connectionState === "open") {
        setStatus("connected")
      } else {
        setStatus("disconnected")
      }
    } catch {
      setStatus("disconnected")
    }
  }, [])

  useEffect(() => {
    refreshStatus()
    return () => stopPolling()
  }, [refreshStatus, stopPolling])

  const startPolling = useCallback(() => {
    stopPolling()
    const started = Date.now()
    pollRef.current = setInterval(async () => {
      if (Date.now() - started > 90_000) {
        stopPolling()
        setError("Tiempo agotado. Probá de nuevo.")
        setStatus("disconnected")
        return
      }
      try {
        const res = await fetch("/api/whatsapp/evolution/qr")
        const data = await res.json().catch(() => ({}))
        if (data?.state === "open") {
          stopPolling()
          setQr(null)
          setPairingCode(null)
          setStatus("connected")
        }
      } catch {
        /* sigue intentando */
      }
    }, 3000)
  }, [stopPolling])

  const handleConnect = async () => {
    setError(null)
    setStatus("pairing")
    try {
      const res = await fetch("/api/whatsapp/evolution/connect", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || "No se pudo iniciar la conexión")
        setStatus("disconnected")
        return
      }
      setQr(data.qrBase64 || null)
      setPairingCode(data.pairingCode || null)
      if (data.state === "open") {
        setStatus("connected")
        return
      }
      startPolling()
    } catch {
      setError("Error de red al conectar")
      setStatus("disconnected")
    }
  }

  const handleDisconnect = async () => {
    setError(null)
    try {
      await fetch("/api/whatsapp/evolution/logout", { method: "POST" })
    } finally {
      setQr(null)
      setPairingCode(null)
      setStatus("disconnected")
    }
  }

  return (
    <div className="rounded-lg border bg-card p-6 max-w-lg">
      <div className="flex items-center gap-2 mb-1">
        <MessageCircle className="h-5 w-5 text-green-600" />
        <h2 className="text-base font-semibold">WhatsApp</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Conectá el WhatsApp de tu taller para que los cambios de estado de las órdenes
        se notifiquen automáticamente a tus clientes. Usá un número dedicado.
      </p>

      {status === "loading" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Verificando estado…
        </div>
      )}

      {status === "connected" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" /> WhatsApp conectado — los mensajes salen del número vinculado.
          </div>
          <Button variant="outline" size="sm" onClick={handleDisconnect}>
            Desconectar
          </Button>
        </div>
      )}

      {status === "disconnected" && (
        <Button onClick={handleConnect}>
          <MessageCircle className="h-4 w-4 mr-2" /> Conectar WhatsApp
        </Button>
      )}

      {status === "pairing" && (
        <div className="space-y-3">
          <p className="text-sm">
            Abrí WhatsApp en el teléfono del taller → <strong>Dispositivos vinculados → Vincular un dispositivo</strong> y escaneá:
          </p>
          {qr ? (
            <img src={qr} alt="QR de WhatsApp" className="h-56 w-56 border rounded" />
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Generando QR…
            </div>
          )}
          {pairingCode && (
            <p className="text-sm">
              O ingresá este código en el teléfono: <strong className="tracking-widest">{pairingCode}</strong>
            </p>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="h-3 w-3 animate-spin" /> Esperando vinculación…
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
    </div>
  )
}
