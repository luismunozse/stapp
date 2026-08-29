"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, CheckCircle2, RefreshCw, Send } from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"

type Status = "loading" | "disconnected" | "pairing" | "connected"

/** Cada cuánto consultamos el estado de vinculación. */
const POLL_MS = 3_000
/** Vida útil que le damos al QR en pantalla antes de pedir el siguiente. */
const QR_TTL_MS = 15_000
/** Techo para no pollear para siempre una pestaña que quedó abierta. */
const MAX_VINCULACION_MS = 10 * 60_000

export function WhatsAppSetup() {
  const [status, setStatus] = useState<Status>("loading")
  const [qr, setQr] = useState<string | null>(null)
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [testPhone, setTestPhone] = useState("")
  const [testSending, setTestSending] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

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
    let ultimoQrAt = Date.now()
    pollRef.current = setInterval(async () => {
      if (Date.now() - started > MAX_VINCULACION_MS) {
        stopPolling()
        setError("Se agotó el tiempo de vinculación. Probá de nuevo.")
        setStatus("disconnected")
        return
      }
      // El QR del server vence solo; pedimos el vigente en vez de dejar en
      // pantalla uno que el teléfono ya va a rechazar.
      const tocaQr = Date.now() - ultimoQrAt >= QR_TTL_MS
      try {
        const res = await fetch(`/api/whatsapp/evolution/qr${tocaQr ? "?refresh=1" : ""}`)
        const data = await res.json().catch(() => ({}))
        if (data?.state === "open") {
          stopPolling()
          setQr(null)
          setPairingCode(null)
          setStatus("connected")
          return
        }
        if (tocaQr) {
          ultimoQrAt = Date.now()
          if (data?.qrBase64) {
            setQr(data.qrBase64)
            setPairingCode(data.pairingCode ?? null)
          }
        }
      } catch {
        /* sigue intentando */
      }
    }, POLL_MS)
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

  const handleTestSend = async () => {
    if (!testPhone.trim()) return
    setTestSending(true)
    setTestResult(null)
    try {
      const res = await fetch("/api/whatsapp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: testPhone }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.success) {
        // El proveedor se muestra a proposito: es el dato que dice si el
        // mensaje salio por Evolution o por Meta cuando hay que diagnosticar.
        setTestResult({ ok: true, text: `Enviado por ${data.provider ?? "el proveedor configurado"}. Revisá el teléfono.` })
      } else {
        setTestResult({ ok: false, text: data?.error || "No se pudo enviar el mensaje de prueba" })
      }
    } catch {
      setTestResult({ ok: false, text: "Error de red al enviar la prueba" })
    } finally {
      setTestSending(false)
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
        <WhatsAppIcon className="h-5 w-5 text-green-600" />
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
          <div className="flex items-center gap-2 text-sm text-success-600">
            <CheckCircle2 className="h-4 w-4" /> WhatsApp conectado — los mensajes salen del número vinculado.
          </div>
          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
            <Label htmlFor="wa-test-phone" className="text-sm font-medium">
              Probar el envío
            </Label>
            <p className="text-xs text-muted-foreground">
              Mandate un mensaje a tu propio teléfono para confirmar que llega, y que llega completo.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="wa-test-phone"
                type="tel"
                inputMode="tel"
                placeholder="+54 9 11 2233-4455"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                className="sm:flex-1"
              />
              <Button size="sm" onClick={handleTestSend} disabled={testSending || !testPhone.trim()}>
                {testSending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Enviar prueba
              </Button>
            </div>
            {testResult && (
              <p className={testResult.ok ? "text-sm text-success-600" : "text-sm text-destructive"}>
                {testResult.text}
              </p>
            )}
          </div>

          <Button variant="outline" size="sm" onClick={handleDisconnect}>
            Desconectar
          </Button>
        </div>
      )}

      {status === "disconnected" && (
        <Button onClick={handleConnect}>
          <WhatsAppIcon className="h-4 w-4 mr-2" /> Conectar WhatsApp
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

      {error && <p className="text-sm text-destructive mt-3">{error}</p>}
    </div>
  )
}
