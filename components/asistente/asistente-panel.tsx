"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { X, Send, Sparkles, RotateCcw, Copy, Check, AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { cn } from "@/lib/utils"
import { useEscapeKey } from "@/hooks/use-escape-key"
import { leerNdjson } from "@/lib/asistente/leer-ndjson"
import { SUGERENCIAS_MANUAL } from "@/lib/asistente/sugerencias"
import { MensajeAsistente } from "./mensaje-asistente"

interface Message {
  id: string
  tipo: "USER" | "ASSISTANT"
  contenido: string
  /** `escribiendo`: la respuesta está llegando. `error`: no se pudo responder. */
  estado?: "escribiendo" | "error"
  /** Qué está consultando mientras escribe ("Buscando órdenes…"). */
  etiqueta?: string
  /** En un error: el mensaje del usuario a reenviar con "Reintentar" (sin él, no se puede reintentar). */
  reintentar?: string
}

type EventoStream =
  | { tipo: "conversacion"; conversacionId: string }
  | { tipo: "herramienta"; etiqueta: string }
  | { tipo: "texto"; delta: string }
  | { tipo: "fin"; texto: string; conversacionId: string; restantes: number }
  | { tipo: "error"; error: string }

interface AsistentePanelProps {
  open: boolean
  onClose: () => void
}

/** Errores que no se arreglan reintentando. */
const SIN_REINTENTO = new Set(["DAILY_LIMIT", "ASISTENTE_NOT_AVAILABLE"])
/** Desde cuántas consultas restantes se avisa. */
const AVISO_RESTANTES = 10
const CLAVE_CONVERSACION = "stapp:asistente:conversacion"
const ERROR_CONEXION = "No pude conectarme. Revisá tu conexión y probá de nuevo."
const ERROR_GENERICO = "Hubo un problema. Probá de nuevo en unos segundos."
const ALTO_MAX_INPUT = 160

function leerConversacionGuardada(): string | null {
  try {
    return window.localStorage.getItem(CLAVE_CONVERSACION)
  } catch {
    return null
  }
}

function guardarConversacion(id: string | null) {
  try {
    if (id) window.localStorage.setItem(CLAVE_CONVERSACION, id)
    else window.localStorage.removeItem(CLAVE_CONVERSACION)
  } catch {
    /* sin almacenamiento: la conversación solo dura hasta recargar */
  }
}

const esMovil = () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches
const esTactil = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches

/** Tres puntos; si tarda, dice qué está haciendo. */
function Escribiendo({ etiqueta }: { etiqueta?: string }) {
  const [lento, setLento] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setLento(true), 2000)
    return () => clearTimeout(t)
  }, [])
  const texto = etiqueta ?? (lento ? "Pensando…" : null)
  return (
    <div className="flex items-center gap-2 text-muted-foreground" role="status" aria-label={texto ?? "Escribiendo respuesta"}>
      <span className="flex gap-1" aria-hidden>
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 rounded-full bg-current animate-bounce motion-reduce:animate-none"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      {texto && <span className="text-xs">{texto}</span>}
    </div>
  )
}

function BotonCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false)
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      /* el navegador no dejó copiar */
    }
  }
  return (
    <IconButton
      label={copiado ? "Copiado" : "Copiar respuesta"}
      variant="ghost"
      onClick={copiar}
      className="h-7 w-7 text-muted-foreground hover:text-foreground"
    >
      {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </IconButton>
  )
}

export function AsistentePanel({ open, onClose }: AsistentePanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [conversacionId, setConversacionId] = useState<string | null>(null)
  const [sugerencias, setSugerencias] = useState<string[]>(SUGERENCIAS_MANUAL)
  const [restantes, setRestantes] = useState<number | null>(null)
  const [anuncio, setAnuncio] = useState("")
  const cargado = useRef(false)
  const listaRef = useRef<HTMLDivElement>(null)
  const pegadoAbajo = useRef(true)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEscapeKey(onClose, open)

  // Al abrir por primera vez: sugerencias según permisos, consultas restantes y la conversación
  // anterior (si este navegador tiene una guardada y es del usuario).
  useEffect(() => {
    if (!open || cargado.current) return
    cargado.current = true
    const guardada = leerConversacionGuardada()
    const url = guardada ? `/api/asistente?conversacionId=${encodeURIComponent(guardada)}` : "/api/asistente"
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return
        if (Array.isArray(data.sugerencias) && data.sugerencias.length > 0) setSugerencias(data.sugerencias)
        if (typeof data.restantes === "number") setRestantes(data.restantes)
        if (data.conversacion) {
          setConversacionId(data.conversacion.id)
          // Solo si el usuario no empezó a escribir mientras cargaba.
          setMessages((prev) => (prev.length > 0 ? prev : data.conversacion.mensajes))
        } else if (guardada) {
          guardarConversacion(null)
        }
      })
      .catch(() => {
        /* sin datos: quedan las sugerencias del manual */
      })
  }, [open])

  useEffect(() => {
    const lista = listaRef.current
    if (lista && pegadoAbajo.current) lista.scrollTop = lista.scrollHeight
  }, [messages])

  useEffect(() => {
    if (open) {
      // Esperar a que termine de entrar el panel antes de enfocar.
      const t = setTimeout(() => inputRef.current?.focus(), 150)
      return () => clearTimeout(t)
    }
  }, [open])

  // El campo crece con el texto hasta ~6 líneas.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, ALTO_MAX_INPUT)}px`
  }, [input])

  const actualizar = (id: string, cambio: (m: Message) => Message) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? cambio(m) : m)))

  const sendMessage = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || isLoading) return
      setInput("")
      const respuestaId = crypto.randomUUID()
      pegadoAbajo.current = true
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), tipo: "USER", contenido: text },
        { id: respuestaId, tipo: "ASSISTANT", contenido: "", estado: "escribiendo" },
      ])
      setIsLoading(true)

      const fallar = (error: string, code?: string) =>
        actualizar(respuestaId, (m) => ({
          ...m,
          contenido: error,
          estado: "error",
          etiqueta: undefined,
          reintentar: code && SIN_REINTENTO.has(code) ? undefined : text,
        }))

      try {
        const res = await fetch("/api/asistente", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/x-ndjson" },
          body: JSON.stringify({ message: text, conversacionId }),
        })

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}))
          if (data.code === "DAILY_LIMIT") setRestantes(0)
          fallar(data.error ?? ERROR_GENERICO, data.code)
          return
        }

        // Un servidor viejo (sin streaming) responde JSON: mostrarlo igual.
        if (!res.headers.get("content-type")?.includes("ndjson")) {
          const data = await res.json()
          if (data.conversacionId) {
            setConversacionId(data.conversacionId)
            guardarConversacion(data.conversacionId)
          }
          if (typeof data.restantes === "number") setRestantes(data.restantes)
          actualizar(respuestaId, (m) => ({ ...m, contenido: data.message ?? "", estado: undefined }))
          setAnuncio(data.message ?? "")
          return
        }

        let termino = false
        for await (const evento of leerNdjson<EventoStream>(res.body)) {
          if (evento.tipo === "conversacion") {
            setConversacionId(evento.conversacionId)
            guardarConversacion(evento.conversacionId)
          } else if (evento.tipo === "herramienta") {
            actualizar(respuestaId, (m) => ({ ...m, etiqueta: evento.etiqueta }))
          } else if (evento.tipo === "texto") {
            actualizar(respuestaId, (m) => ({ ...m, contenido: m.contenido + evento.delta, etiqueta: undefined }))
          } else if (evento.tipo === "fin") {
            termino = true
            setRestantes(evento.restantes)
            // El texto final manda: puede diferir de lo que llegó en partes (p. ej. un rechazo).
            actualizar(respuestaId, (m) => ({ ...m, contenido: evento.texto, estado: undefined, etiqueta: undefined }))
            setAnuncio(evento.texto)
          } else if (evento.tipo === "error") {
            termino = true
            fallar(evento.error)
          }
        }
        if (!termino) fallar(ERROR_CONEXION)
      } catch {
        fallar(ERROR_CONEXION)
      } finally {
        setIsLoading(false)
        // Devolver el foco para seguir preguntando (en el celular no: abriría el teclado).
        if (!esTactil()) setTimeout(() => inputRef.current?.focus(), 0)
      }
    },
    [conversacionId, isLoading]
  )

  const reintentar = (errorId: string, texto: string) => {
    // Sacar el error y la pregunta que lo causó; sendMessage la vuelve a agregar.
    setMessages((prev) => {
      const i = prev.findIndex((m) => m.id === errorId)
      if (i === -1) return prev
      const desde = i > 0 && prev[i - 1].tipo === "USER" ? i - 1 : i
      return [...prev.slice(0, desde), ...prev.slice(i + 1)]
    })
    sendMessage(texto)
  }

  const nuevaConversacion = () => {
    setMessages([])
    setConversacionId(null)
    guardarConversacion(null)
    setInput("")
    inputRef.current?.focus()
  }

  const sinConsultas = restantes === 0
  const navegar = () => {
    // En móvil el panel tapa la pantalla: cerrarlo para ver la página.
    if (esMovil()) onClose()
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
            Tus órdenes, tus clientes y cómo usar el sistema
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

      <div
        ref={listaRef}
        onScroll={(e) => {
          const el = e.currentTarget
          pegadoAbajo.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="flex-1 overflow-y-auto p-4 space-y-3"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col justify-end gap-4 pb-2">
            <div className="flex flex-col items-center text-center gap-3 py-6">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="h-7 w-7" aria-hidden />
              </span>
              <div>
                <p className="font-semibold">¡Hola! ¿En qué te ayudo?</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                  Puedo consultar tus órdenes y tus clientes, y explicarte cómo usar STApp.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {sugerencias.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => sendMessage(s)}
                  disabled={sinConsultas}
                  className="text-left text-sm rounded-xl border px-3 py-2.5 hover:bg-accent hover:border-primary/40 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) =>
            m.tipo === "USER" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary text-primary-foreground px-3.5 py-2 text-sm whitespace-pre-wrap break-words">
                  {m.contenido}
                </div>
              </div>
            ) : m.estado === "error" ? (
              <div key={m.id} className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-destructive/30 bg-destructive/5 px-3.5 py-2 text-sm">
                  <p className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" aria-hidden />
                    <span>{m.contenido}</span>
                  </p>
                  {m.reintentar && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 h-8"
                      disabled={isLoading}
                      onClick={() => reintentar(m.id, m.reintentar!)}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                      Reintentar
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex flex-col items-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-muted px-3.5 py-2 text-sm">
                  {m.contenido && <MensajeAsistente contenido={m.contenido} onNavegar={navegar} />}
                  {m.estado === "escribiendo" && (m.etiqueta || !m.contenido) && (
                    <div className={cn(m.contenido && "mt-2")}>
                      <Escribiendo etiqueta={m.etiqueta} />
                    </div>
                  )}
                </div>
                {!m.estado && m.contenido && (
                  <div className="mt-0.5 ml-1">
                    <BotonCopiar texto={m.contenido} />
                  </div>
                )}
              </div>
            )
          )
        )}
      </div>

      {/* Para lectores de pantalla: la respuesta completa una sola vez, no cada fragmento. */}
      <p className="sr-only" aria-live="polite">
        {anuncio}
      </p>

      <form
        className="border-t p-3 shrink-0"
        onSubmit={(e) => {
          e.preventDefault()
          sendMessage(input)
        }}
      >
        {restantes !== null && restantes < AVISO_RESTANTES && (
          <p className={cn("text-xs mb-2", sinConsultas ? "text-destructive" : "text-muted-foreground")}>
            {sinConsultas
              ? "Se terminaron las consultas de hoy para tu taller. Mañana se renuevan."
              : restantes === 1
                ? "Queda 1 consulta hoy para tu taller."
                : `Quedan ${restantes} consultas hoy para tu taller.`}
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter envía; Shift+Enter (o Enter en el teclado del celular) hace un salto de línea.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !esTactil()) {
                e.preventDefault()
                sendMessage(input)
              }
            }}
            rows={1}
            placeholder={sinConsultas ? "Volvé mañana" : "Preguntá por una orden, un cliente o cómo hacer algo"}
            aria-label="Escribí tu pregunta"
            maxLength={1000}
            disabled={isLoading || sinConsultas}
            className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm leading-snug placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Button
            type="submit"
            disabled={isLoading || sinConsultas || !input.trim()}
            size="icon"
            aria-label="Enviar"
            className="shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </form>
    </aside>
  )
}
