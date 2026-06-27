// components/chatbot/lead-capture-form.tsx
"use client"

import { useState } from "react"
import { Loader2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { validateLeadForm } from "./lead-form-validation"

interface LeadCaptureFormProps {
  sessionId: string
  conversacionId: string | null
  onCaptured: () => void
}

export function LeadCaptureForm({ sessionId, conversacionId, onCaptured }: LeadCaptureFormProps) {
  const [nombre, setNombre] = useState("")
  const [whatsapp, setWhatsapp] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    setError(null)
    const v = validateLeadForm({ nombre, whatsapp })
    if (!v.ok) {
      setError(v.error ?? "Revisá los datos")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/chatbot/capture-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          conversacionId: conversacionId ?? undefined,
          nombre: nombre.trim(),
          telefono: v.telefono,
          fuente: "form",
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "No se pudo enviar")
      }
      onCaptured()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar. Probá de nuevo.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="my-3 rounded-xl border bg-muted/40 p-3 space-y-2">
      <p className="text-sm font-medium">Dejanos tus datos y te contactamos 👇</p>
      <Input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Tu nombre"
        disabled={submitting}
      />
      <Input
        value={whatsapp}
        onChange={(e) => setWhatsapp(e.target.value)}
        placeholder="Tu WhatsApp"
        inputMode="tel"
        disabled={submitting}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button onClick={handleSubmit} disabled={submitting} className="w-full" size="sm">
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
        Enviar
      </Button>
    </div>
  )
}
