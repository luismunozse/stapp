"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { toast } from "sonner"
import Link from "next/link"
import { Clipboard, FlaskConical, Inbox, Loader2, MessageCircle, RefreshCw, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PageShell } from "@/components/ui/page-shell"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useSuperadminFetch, useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import {
  BETA_MAX_IDS_POR_LOTE,
  BETA_MENSAJE_MAX,
  emailsParaPlay,
  mensajeInvitacion,
  type BetaEstado,
} from "@/lib/android-beta"
import { cn, formatDateTime } from "@/lib/utils"

interface Tester {
  id: string
  email: string
  estado: BetaEstado
  created_at: string
  agregado_at: string | null
  usuario: { nombre: string; email: string } | null
  taller: string | null
}

type Filtro = BetaEstado | "TODOS"

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: "PENDIENTE", etiqueta: "Pendientes" },
  { valor: "AGREGADO", etiqueta: "Agregados" },
  { valor: "DESCARTADO", etiqueta: "Descartados" },
  { valor: "TODOS", etiqueta: "Todos" },
]

const estadoColors: Record<BetaEstado, string> = {
  PENDIENTE: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  AGREGADO: "bg-green-500/10 text-green-700 dark:text-green-400",
  DESCARTADO: "bg-muted text-muted-foreground",
}

export function BetaAndroidContent() {
  const { data, loading, fetchData } = useSuperadminFetch<{ testers: Tester[] }>()
  const { mutate, loading: guardando } = useSuperadminMutation()
  const [filtro, setFiltro] = useState<Filtro>("PENDIENTE")
  const [seleccion, setSeleccion] = useState<string[]>([])
  const { mutate: enviar, loading: enviando } = useSuperadminMutation<{ ticketId: string }>()
  const [contacto, setContacto] = useState<Tester | null>(null)
  const [mensaje, setMensaje] = useState("")
  // Conversaciones abiertas en esta sesión, para dejar el acceso a mano en la fila.
  const [conversaciones, setConversaciones] = useState<Record<string, string>>({})

  // Se trae todo de una vez y se filtra acá: así "Copiar emails pendientes"
  // funciona igual aunque la vista esté mirando otro estado, y los contadores
  // de cada pestaña salen sin pedir nada más.
  const cargar = useCallback(() => fetchData("/api/superadmin/beta-android"), [fetchData])

  useEffect(() => {
    cargar()
  }, [cargar])

  const testers = useMemo(() => data?.testers ?? [], [data])
  const visibles = useMemo(
    () => (filtro === "TODOS" ? testers : testers.filter((t) => t.estado === filtro)),
    [testers, filtro]
  )
  const conteo = useMemo(
    () => ({
      PENDIENTE: testers.filter((t) => t.estado === "PENDIENTE").length,
      AGREGADO: testers.filter((t) => t.estado === "AGREGADO").length,
      DESCARTADO: testers.filter((t) => t.estado === "DESCARTADO").length,
      TODOS: testers.length,
    }),
    [testers]
  )
  const emailsPendientes = useMemo(() => emailsParaPlay(testers), [testers])

  const cambiarFiltro = (nuevo: Filtro) => {
    setFiltro(nuevo)
    setSeleccion([])
  }

  const copiarPendientes = async () => {
    try {
      await navigator.clipboard.writeText(emailsPendientes.join(","))
      toast.success(
        `${emailsPendientes.length} ${emailsPendientes.length === 1 ? "email copiado" : "emails copiados"}`
      )
    } catch {
      toast.error("No se pudo copiar al portapapeles")
    }
  }

  // La API acepta hasta BETA_MAX_IDS_POR_LOTE ids por pedido: las selecciones
  // grandes se mandan en lotes, en orden. Si uno falla se corta (el hook ya
  // avisó el error) y se recarga la lista para ver qué llegó a aplicarse.
  const marcar = async (estado: BetaEstado, mensaje: string) => {
    for (let i = 0; i < seleccion.length; i += BETA_MAX_IDS_POR_LOTE) {
      const resultado = await mutate("/api/superadmin/beta-android", {
        method: "PATCH",
        body: { ids: seleccion.slice(i, i + BETA_MAX_IDS_POR_LOTE), estado },
        errorMessage: "Error al actualizar",
      })
      if (!resultado) {
        setSeleccion([])
        cargar()
        return
      }
    }
    toast.success(mensaje)
    setSeleccion([])
    cargar()
  }

  const abrirContacto = (t: Tester) => {
    setContacto(t)
    setMensaje(mensajeInvitacion(t.usuario?.nombre, t.email))
  }

  const enviarMensaje = async () => {
    if (!contacto) return
    const resultado = await enviar("/api/superadmin/beta-android/contactar", {
      method: "POST",
      body: { id: contacto.id, mensaje },
      errorMessage: "Error al enviar el mensaje",
    })
    if (!resultado) return
    setConversaciones((prev) => ({ ...prev, [contacto.id]: resultado.ticketId }))
    toast.success("Mensaje enviado al chat de soporte del usuario")
    setContacto(null)
  }

  const todosMarcados = visibles.length > 0 && seleccion.length === visibles.length
  const alternarTodos = () => setSeleccion(todosMarcados ? [] : visibles.map((t) => t.id))
  const alternarFila = (id: string) =>
    setSeleccion((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <PageShell
      title="Beta de Android"
      description="Usuarios que se anotaron desde la app. Copiá los pendientes, pegalos en la lista de testers de Play Console y marcalos como agregados."
      icon={FlaskConical}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={cargar} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            Actualizar
          </Button>
          <Button size="sm" onClick={copiarPendientes} disabled={emailsPendientes.length === 0}>
            <Clipboard className="h-4 w-4 mr-2" />
            Copiar emails pendientes ({emailsPendientes.length})
          </Button>
        </>
      }
    >

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <CardTitle>Inscriptos</CardTitle>
            <div className="flex flex-wrap gap-2">
              {FILTROS.map(({ valor, etiqueta }) => (
                <Button
                  key={valor}
                  size="sm"
                  variant={filtro === valor ? "default" : "outline"}
                  onClick={() => cambiarFiltro(valor)}
                >
                  {etiqueta} {conteo[valor]}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {seleccion.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-lg bg-muted/50 border">
              <span className="text-sm font-medium">{seleccion.length} seleccionados</span>
              <div className="flex flex-wrap gap-2 ml-auto">
                <Button
                  size="sm"
                  onClick={() => marcar("AGREGADO", `${seleccion.length} marcados como agregados`)}
                  disabled={guardando}
                >
                  {guardando && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  Marcar como agregados
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => marcar("DESCARTADO", `${seleccion.length} descartados`)}
                  disabled={guardando}
                >
                  Descartar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSeleccion([])} disabled={guardando}>
                  <X className="h-4 w-4 mr-1.5" />
                  Deseleccionar
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="w-12 px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={todosMarcados}
                        onChange={alternarTodos}
                        aria-label="Seleccionar todos"
                        className="h-4 w-4 rounded border-input"
                      />
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Usuario</th>
                    <th className="hidden md:table-cell px-4 py-3 text-left font-medium text-muted-foreground">Taller</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email de Google</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Estado</th>
                    <th className="hidden sm:table-cell px-4 py-3 text-left font-medium text-muted-foreground">Fecha</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Contacto</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && testers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        <div className="flex items-center justify-center gap-2">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                          Cargando...
                        </div>
                      </td>
                    </tr>
                  ) : visibles.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-0">
                        <div className="flex flex-col items-center justify-center py-12 px-4">
                          <div className="flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-muted">
                            <Inbox className="h-8 w-8 text-muted-foreground" />
                          </div>
                          <h3 className="text-lg font-semibold mb-2">No hay inscriptos en esta vista</h3>
                          <p className="text-sm text-muted-foreground text-center max-w-sm">
                            Los usuarios que se sumen a la beta desde la app aparecen acá.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    visibles.map((t) => {
                      const marcada = seleccion.includes(t.id)
                      return (
                        <tr
                          key={t.id}
                          className={cn(
                            "border-b last:border-0 transition-colors hover:bg-muted/50",
                            marcada && "bg-primary/5"
                          )}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={marcada}
                              onChange={() => alternarFila(t.id)}
                              aria-label={`Seleccionar ${t.email}`}
                              className="h-4 w-4 rounded border-input"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium">{t.usuario?.nombre ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{t.usuario?.email}</div>
                          </td>
                          <td className="hidden md:table-cell px-4 py-3">{t.taller ?? "—"}</td>
                          <td className="px-4 py-3 font-medium">{t.email}</td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className={estadoColors[t.estado]}>
                              {t.estado}
                            </Badge>
                          </td>
                          <td className="hidden sm:table-cell px-4 py-3 text-muted-foreground">
                            {formatDateTime(t.created_at)}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {conversaciones[t.id] && (
                              <Button asChild size="sm" variant="link">
                                <Link href={`/superadmin/soporte/${conversaciones[t.id]}`}>Ver chat</Link>
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => abrirContacto(t)}
                              disabled={!t.usuario}
                              aria-label={`Contactar a ${t.usuario?.nombre ?? t.email}`}
                            >
                              <MessageCircle className="h-4 w-4 mr-1.5" />
                              Contactar
                            </Button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={contacto !== null} onOpenChange={(abierto) => !abierto && !enviando && setContacto(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Escribirle a {contacto?.usuario?.nombre ?? contacto?.email}</DialogTitle>
            <DialogDescription>
              Le llega al chat de soporte de su panel y por mail a {contacto?.usuario?.email}. Cargalo antes en la
              lista de testers de Play Console: si abre el enlace sin estar en la lista, no lo deja entrar.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            rows={9}
            maxLength={BETA_MENSAJE_MAX}
            aria-label="Mensaje"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setContacto(null)} disabled={enviando}>
              Cancelar
            </Button>
            <Button onClick={enviarMensaje} disabled={enviando || mensaje.trim().length === 0}>
              {enviando && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Enviar mensaje
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
