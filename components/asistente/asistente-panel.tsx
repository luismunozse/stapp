"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { X, Send, Loader2, Sparkles, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { IconButton } from "@/components/ui/icon-button"
import { cn } from "@/lib/utils"
import { parseAsistenteLinks } from "@/lib/asistente/parse-links"
import { useEscapeKey } from "@/hooks/use-escape-key"

interface Message {
  id: string
  tipo: "USER" | "ASSISTANT"
  contenido: string
}

interface AsistentePanelProps {
  open: boolean
  onClose: () => void
}

const SUGERENCIAS = [
  "¿Cómo creo una orden de servicio?",
  "¿Cómo abro y cierro la caja?",
  "¿Cómo cargo stock en el inventario?",
  "¿Cómo conecto WhatsApp?",
]

export function AsistentePanel({ open, onClose }: AsistentePanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [conversacionId, setConversacionId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEscapeKey(onClose, open)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isLoading])

  useEffect(() => {
    if (open) {
      // Esperar a que termine de entrar el panel antes de enfocar.
      const t = setTimeout(() => inputRef.current?.focus(), 150)
      return () => clearTimeout(t)
    }
  }, [open])

  const addAssistant = (contenido: string) =>
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), tipo: "ASSISTANT", contenido }])

  const sendMessage = useCallback(
    async (raw: string) => {
      const text = raw.trim()
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
          addAssistant(data.error ?? "Hubo un problema. Probá de nuevo en unos segundos.")
          return
        }
        setConversacionId(data.conversacionId)
        addAssistant(data.message)
      } catch {
        addAssistant("No pude conectarme. Revisá tu conexión y probá de nuevo.")
      } finally {
        setIsLoading(false)
      }
    },
    [conversacionId, isLoading]
  )

  const nuevaConversacion = () => {
    setMessages([])
    setConversacionId(null)
    setInput("")
    inputRef.current?.focus()
  }

  return (
    <aside
      id="asistente-panel"
      aria-label="Asistente de STApp"
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "fixed z-[60] flex flex-col bg-card shadow-2xl transition-transform duration-300 ease-snappy",
        // Móvil: pantalla completa. Escritorio: panel lateral derecho de alto completo.
        "inset-0 lg:inset-auto lg:top-0 lg:right-0 lg:bottom-0 lg:w-[420px] lg:border-l",
        "pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]",
        open ? "translate-x-0" : "translate-x-full invisible"
      )}
    >
      <header className="flex items-center gap-3 px-4 h-14 border-b shrink-0">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm leading-tight">Asistente de STApp</p>
          <p className="text-xs text-muted-foreground leading-tight truncate">
            Dudas sobre cómo usar el sistema
          </p>
        </div>
        {messages.length > 0 && (
          <IconButton label="Nueva conversación" onClick={nuevaConversacion} disabled={isLoading}>
            <RotateCcw className="h-4 w-4" />
          </IconButton>
        )}
        <IconButton label="Cerrar asistente" onClick={onClose}>
          <X className="h-5 w-5" />
        </IconButton>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3" aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col justify-end gap-4 pb-2">
            <div className="flex flex-col items-center text-center gap-3 py-6">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="h-7 w-7" aria-hidden />
              </span>
              <div>
                <p className="font-semibold">¡Hola! ¿En qué te ayudo?</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                  Preguntame lo que quieras sobre cómo usar STApp: órdenes, inventario, caja, reportes y más.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => sendMessage(s)}
                  className="text-left text-sm rounded-xl border px-3 py-2.5 hover:bg-accent hover:border-primary/40 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={cn("flex", m.tipo === "USER" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap",
                  m.tipo === "USER"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-muted rounded-bl-md"
                )}
              >
                {m.tipo === "ASSISTANT"
                  ? parseAsistenteLinks(m.contenido).map((seg, i) =>
                      seg.type === "link" ? (
                        <Link
                          key={i}
                          href={seg.href}
                          onClick={() => {
                            // En móvil el panel tapa la pantalla: cerrarlo para ver la página.
                            if (window.matchMedia("(max-width: 1023px)").matches) onClose()
                          }}
                          className="underline text-primary font-medium"
                        >
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
          ))
        )}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-2xl rounded-bl-md px-3.5 py-2.5">
              <Loader2 className="w-4 h-4 animate-spin" aria-label="Escribiendo respuesta" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form
        className="border-t p-3 flex gap-2 shrink-0"
        onSubmit={(e) => {
          e.preventDefault()
          sendMessage(input)
        }}
      >
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="¿Cómo hago para...?"
          aria-label="Escribí tu pregunta"
          maxLength={1000}
          disabled={isLoading}
        />
        <Button type="submit" disabled={isLoading || !input.trim()} size="icon" aria-label="Enviar">
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </aside>
  )
}
