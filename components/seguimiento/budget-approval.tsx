"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { DollarSign, CheckCircle2, XCircle, Loader2, PenTool } from "lucide-react"

interface BudgetApprovalProps {
  token: string
  presupuesto: number
  moneda?: string
  dispositivo: string
  onApproved?: () => void
}

export function BudgetApproval({
  token,
  presupuesto,
  moneda = "ARS",
  dispositivo,
  onApproved,
}: BudgetApprovalProps) {
  const [step, setStep] = useState<"info" | "sign" | "reject" | "done" | "rejected">("info")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejectMotivo, setRejectMotivo] = useState("")
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: moneda,
      minimumFractionDigits: 0,
    }).format(amount)
  }

  // Canvas drawing handlers
  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    setIsDrawing(true)
    setHasSignature(true)
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    const { x, y } = getPos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!isDrawing) return
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    const { x, y } = getPos(e)
    ctx.lineTo(x, y)
    ctx.strokeStyle = "#000"
    ctx.lineWidth = 2
    ctx.lineCap = "round"
    ctx.stroke()
  }

  const stopDrawing = () => setIsDrawing(false)

  const clearSignature = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
  }

  const handleApprove = async () => {
    setLoading(true)
    setError(null)

    try {
      let firma: string | null = null
      if (canvasRef.current && hasSignature) {
        firma = canvasRef.current.toDataURL("image/png")
      }

      const res = await fetch(`/api/public/ordenes/${token}/approve-budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firma }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Error al aprobar")
        return
      }

      setStep("done")
      onApproved?.()
    } catch {
      setError("Error de conexión. Intentá de nuevo.")
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/public/ordenes/${token}/reject-budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: rejectMotivo || undefined }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Error al rechazar")
        return
      }

      setStep("rejected")
      onApproved?.()
    } catch {
      setError("Error de conexión. Intentá de nuevo.")
    } finally {
      setLoading(false)
    }
  }

  if (step === "done") {
    return (
      <Card className="border-green-200 dark:border-green-800">
        <CardContent className="pt-6 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
          <p className="font-semibold text-lg">Presupuesto aprobado</p>
          <p className="text-sm text-muted-foreground mt-1">
            El taller ha sido notificado y comenzará la reparación.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (step === "rejected") {
    return (
      <Card className="border-red-200 dark:border-red-800">
        <CardContent className="pt-6 text-center">
          <XCircle className="h-12 w-12 text-red-500 mx-auto mb-3" />
          <p className="font-semibold text-lg">Presupuesto rechazado</p>
          <p className="text-sm text-muted-foreground mt-1">
            El taller ha sido notificado. Pueden contactarte para ofrecer alternativas.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-amber-200 dark:border-amber-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <DollarSign className="h-5 w-5 text-amber-600" />
          Presupuesto pendiente de aprobación
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-amber-50 dark:bg-amber-950/50 rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Reparación de</p>
          <p className="font-medium">{dispositivo}</p>
          <p className="text-2xl font-bold mt-2 text-amber-700 dark:text-amber-300">
            {formatPrice(presupuesto)}
          </p>
        </div>

        {step === "info" && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => setStep("reject")}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Rechazar
            </Button>
            <Button
              onClick={() => setStep("sign")}
              className="flex-1 bg-amber-600 hover:bg-amber-700"
            >
              <PenTool className="mr-2 h-4 w-4" />
              Aprobar presupuesto
            </Button>
          </div>
        )}

        {step === "reject" && (
          <div className="border border-red-200 rounded-lg p-4 space-y-3 bg-red-50/50 dark:bg-red-950/20">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">
              ¿Estás seguro de rechazar el presupuesto?
            </p>
            <p className="text-xs text-muted-foreground">
              El taller será notificado y podrá contactarte para ofrecer alternativas.
            </p>

            <Textarea
              placeholder="Motivo del rechazo (opcional)"
              value={rejectMotivo}
              onChange={(e) => setRejectMotivo(e.target.value)}
              disabled={loading}
              rows={2}
              maxLength={500}
              className="text-sm"
            />

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setStep("info")
                  setRejectMotivo("")
                  setError(null)
                }}
                disabled={loading}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleReject}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-2 h-4 w-4" />
                )}
                Confirmar rechazo
              </Button>
            </div>
          </div>
        )}

        {step === "sign" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Firmá abajo para confirmar la aprobación:
            </p>
            <div className="border rounded-lg overflow-hidden bg-white">
              <canvas
                ref={canvasRef}
                width={400}
                height={150}
                className="w-full touch-none cursor-crosshair"
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={clearSignature}
              >
                Limpiar
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep("info")}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={handleApprove}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Confirmar aprobación
              </Button>
            </div>
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
