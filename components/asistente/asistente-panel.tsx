"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { X, Send, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { parseAsistenteLinks } from "@/lib/asistente/parse-links"

interface Message {
  id: string
  tipo: "USER" | "ASSISTANT"
  contenido: string
}

interface AsistentePanelProps {
  onClose: () => void
}

const WELCOME =
  "¡Hola! Soy el asistente de STApp. Preguntame lo que quieras sobre cómo usar el sistema: órdenes, inventario, cotizaciones, reportes y más."

export function AsistentePanel({ onClose }: AsistentePanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", tipo: "ASSISTANT", contenido: WELCOME },
  ])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [conversacionId, setConversacionId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || isLoading) return
    setInput("")
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), tipo: "USER", contenido: text }])
    setIsLoading(true)
    try {
      const res = await fetch("/api/asistente", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, conversacionId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            tipo: "ASSISTANT",
            contenido: data.error ?? "Hubo un problema. Probá de nuevo en unos segundos.",
          },
        ])
        return
      }
      setConversacionId(data.conversacionId)
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), tipo: "ASSISTANT", contenido: data.message },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          tipo: "ASSISTANT",
          contenido: "No pude conectarme. Revisá tu conexión y probá de nuevo.",
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-[60] w-[90vw] max-w-md h-[500px] max-h-[75vh] bg-card border shadow-2xl rounded-2xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-primary text-primary-foreground">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          <span className="font-medium text-sm">Asistente de STApp</span>
        </div>
        <button onClick={onClose} aria-label="Cerrar asistente" className="hover:opacity-80">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.tipo === "USER" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap",
                m.tipo === "USER" ? "bg-primary text-primary-foreground" : "bg-muted"
              )}
            >
              {m.tipo === "ASSISTANT"
                ? parseAsistenteLinks(m.contenido).map((seg, i) =>
                    seg.type === "link" ? (
                      <Link key={i} href={seg.href} className="underline text-primary font-medium">
                        {seg.label}
                      </Link>
                    ) : seg.type === "bold" ? (
                      <strong key={i}>{seg.text}</strong>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    )
                  )
                : m.contenido}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-xl px-3 py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t p-3 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
          placeholder="¿Cómo hago para...?"
          maxLength={1000}
          disabled={isLoading}
        />
        <Button onClick={sendMessage} disabled={isLoading || !input.trim()} size="icon" aria-label="Enviar">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
