"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Send, Loader2, Search, User, X } from "lucide-react"

interface Destinatario {
  id: string
  nombre: string
  email: string
  tipo: "CLIENTE" | "TECNICO" | "VENDEDOR"
}

export function EmailCompose() {
  const [destinatarios, setDestinatarios] = useState<Destinatario[]>([])
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<Destinatario[]>([])
  const [buscando, setBuscando] = useState(false)
  const [showResults, setShowResults] = useState(false)

  const [destinatarioEmail, setDestinatarioEmail] = useState("")
  const [destinatarioNombre, setDestinatarioNombre] = useState("")
  const [destinatarioTipo, setDestinatarioTipo] = useState<string>("")
  const [destinatarioId, setDestinatarioId] = useState<string>("")
  const [asunto, setAsunto] = useState("")
  const [contenido, setContenido] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: "success" | "error"; texto: string } | null>(null)
  const [modoManual, setModoManual] = useState(false)

  const buscarDestinatarios = useCallback(async (query: string) => {
    if (query.length < 2) {
      setResultados([])
      return
    }

    setBuscando(true)
    try {
      const [clientesRes, tecnicosRes, vendedoresRes] = await Promise.all([
        fetch(`/api/clientes?search=${encodeURIComponent(query)}`),
        fetch(`/api/tecnicos`),
        fetch(`/api/vendedores`),
      ])

      const results: Destinatario[] = []

      if (clientesRes.ok) {
        const clientes = await clientesRes.json()
        const lista = Array.isArray(clientes) ? clientes : clientes.clientes || []
        lista
          .filter((c: any) => c.email && (
            c.nombre?.toLowerCase().includes(query.toLowerCase()) ||
            c.email?.toLowerCase().includes(query.toLowerCase())
          ))
          .forEach((c: any) => {
            results.push({ id: c.id, nombre: c.nombre, email: c.email, tipo: "CLIENTE" })
          })
      }

      if (tecnicosRes.ok) {
        const tecnicos = await tecnicosRes.json()
        ;(Array.isArray(tecnicos) ? tecnicos : [])
          .filter((t: any) =>
            t.nombre?.toLowerCase().includes(query.toLowerCase()) ||
            t.email?.toLowerCase().includes(query.toLowerCase())
          )
          .forEach((t: any) => {
            results.push({ id: t.id, nombre: t.nombre, email: t.email, tipo: "TECNICO" })
          })
      }

      if (vendedoresRes.ok) {
        const vendedores = await vendedoresRes.json()
        ;(Array.isArray(vendedores) ? vendedores : [])
          .filter((v: any) =>
            v.nombre?.toLowerCase().includes(query.toLowerCase()) ||
            v.email?.toLowerCase().includes(query.toLowerCase())
          )
          .forEach((v: any) => {
            results.push({ id: v.id, nombre: v.nombre, email: v.email, tipo: "VENDEDOR" })
          })
      }

      setResultados(results)
      setShowResults(true)
    } catch {
      setResultados([])
    } finally {
      setBuscando(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (busqueda.length >= 2) {
        buscarDestinatarios(busqueda)
      } else {
        setResultados([])
        setShowResults(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [busqueda, buscarDestinatarios])

  const seleccionarDestinatario = (d: Destinatario) => {
    setDestinatarioEmail(d.email)
    setDestinatarioNombre(d.nombre)
    setDestinatarioTipo(d.tipo)
    setDestinatarioId(d.id)
    setBusqueda("")
    setShowResults(false)
    setModoManual(false)
  }

  const limpiarDestinatario = () => {
    setDestinatarioEmail("")
    setDestinatarioNombre("")
    setDestinatarioTipo("")
    setDestinatarioId("")
    setBusqueda("")
    setModoManual(false)
  }

  const handleEnviar = async () => {
    if (!destinatarioEmail || !asunto || !contenido) return

    setEnviando(true)
    setMensaje(null)

    try {
      const res = await fetch("/api/emails/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinatarioEmail,
          destinatarioNombre,
          destinatarioTipo: destinatarioTipo || "OTRO",
          destinatarioId: destinatarioId || null,
          asunto,
          contenido,
        }),
      })

      if (res.ok) {
        setMensaje({ tipo: "success", texto: `Email enviado a ${destinatarioNombre || destinatarioEmail}` })
        setAsunto("")
        setContenido("")
        limpiarDestinatario()
      } else {
        const data = await res.json()
        setMensaje({ tipo: "error", texto: data.error || "Error al enviar el email" })
      }
    } catch {
      setMensaje({ tipo: "error", texto: "Error de conexión al enviar el email" })
    } finally {
      setEnviando(false)
    }
  }

  const tipoLabel: Record<string, string> = {
    CLIENTE: "Cliente",
    TECNICO: "Técnico",
    VENDEDOR: "Vendedor",
  }

  const tipoBadgeColor: Record<string, string> = {
    CLIENTE: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    TECNICO: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    VENDEDOR: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          Redactar email
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Destinatario */}
        <div className="space-y-2">
          <Label>Para</Label>
          {destinatarioEmail && !modoManual ? (
            <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/50">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{destinatarioNombre || destinatarioEmail}</span>
              {destinatarioTipo && destinatarioTipo !== "OTRO" && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${tipoBadgeColor[destinatarioTipo] || ""}`}>
                  {tipoLabel[destinatarioTipo] || destinatarioTipo}
                </span>
              )}
              <span className="text-muted-foreground text-sm">{destinatarioEmail}</span>
              <Button variant="ghost" size="sm" className="ml-auto h-6 w-6 p-0" onClick={limpiarDestinatario}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar cliente, técnico o vendedor..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="pl-9"
                />
                {buscando && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>

              {showResults && resultados.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-y-auto">
                  {resultados.map((d) => (
                    <button
                      key={`${d.tipo}-${d.id}`}
                      className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2 text-sm"
                      onClick={() => seleccionarDestinatario(d)}
                    >
                      <User className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium truncate">{d.nombre}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${tipoBadgeColor[d.tipo]}`}>
                        {tipoLabel[d.tipo]}
                      </span>
                      <span className="text-muted-foreground text-xs truncate ml-auto">{d.email}</span>
                    </button>
                  ))}
                </div>
              )}

              {showResults && busqueda.length >= 2 && resultados.length === 0 && !buscando && (
                <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md p-3">
                  <p className="text-sm text-muted-foreground text-center">No se encontraron resultados</p>
                  <Button
                    variant="link"
                    size="sm"
                    className="w-full mt-1"
                    onClick={() => {
                      setModoManual(true)
                      setShowResults(false)
                      setBusqueda("")
                    }}
                  >
                    Ingresar email manualmente
                  </Button>
                </div>
              )}
            </div>
          )}

          {modoManual && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input
                  type="email"
                  placeholder="email@ejemplo.com"
                  value={destinatarioEmail}
                  onChange={(e) => setDestinatarioEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nombre (opcional)</Label>
                <Input
                  placeholder="Nombre del destinatario"
                  value={destinatarioNombre}
                  onChange={(e) => setDestinatarioNombre(e.target.value)}
                />
              </div>
            </div>
          )}

          {!destinatarioEmail && !modoManual && !busqueda && (
            <Button
              variant="link"
              size="sm"
              className="p-0 h-auto text-xs"
              onClick={() => setModoManual(true)}
            >
              O ingresar email manualmente
            </Button>
          )}
        </div>

        {/* Asunto */}
        <div className="space-y-2">
          <Label htmlFor="asunto">Asunto</Label>
          <Input
            id="asunto"
            placeholder="Asunto del email"
            value={asunto}
            onChange={(e) => setAsunto(e.target.value)}
          />
        </div>

        {/* Contenido */}
        <div className="space-y-2">
          <Label htmlFor="contenido">Mensaje</Label>
          <Textarea
            id="contenido"
            placeholder="Escribe tu mensaje aquí..."
            value={contenido}
            onChange={(e) => setContenido(e.target.value)}
            className="min-h-[200px]"
          />
          <p className="text-xs text-muted-foreground">
            El mensaje se enviará con el formato y branding de tu negocio.
          </p>
        </div>

        {/* Mensaje de estado */}
        {mensaje && (
          <div className={`p-3 rounded-md text-sm ${
            mensaje.tipo === "success"
              ? "bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800"
              : "bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800"
          }`}>
            {mensaje.texto}
          </div>
        )}

        {/* Botón enviar */}
        <div className="flex justify-end">
          <Button
            onClick={handleEnviar}
            disabled={!destinatarioEmail || !asunto || !contenido || enviando}
            className="gap-2"
          >
            {enviando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {enviando ? "Enviando..." : "Enviar email"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
