"use client"

import { useCallback, useEffect, useRef, useState, type Ref } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatusBanner, type BannerTone } from "@/components/ui/status-banner"
import { AnularFacturaDialog } from "@/components/ventas/anular-factura-dialog"
import { useCurrency } from "@/contexts/currency-context"
import {
  mensajeFacturaAnulada,
  verificarNotaCreditoArca,
  type ResultadoAnulacion,
} from "@/lib/facturacion/anular-comprobante-client"
import { AVISO_FUERA_DE_PLAZO, avisoDeAnulacion, avisoDeVerificacion } from "@/lib/facturacion/avisos-anulacion"
import {
  etiquetaEstadoComprobante,
  fechaFiscalDMA,
  pdfComprobanteHref,
  tituloComprobante,
  type ComprobanteFiscalDTO,
  type ListadoComprobantesResponse,
} from "@/lib/facturacion/comprobante-ui"

const LIMITE = 20
// Radix Select no admite value "": el "sin filtro" viaja como este valor.
const TODOS = "todos"

const FILTROS_ESTADO = [
  { value: TODOS, label: "Todos los estados" },
  { value: "emitido", label: "Emitidas" },
  { value: "pendiente", label: "En proceso" },
  { value: "rechazado", label: "Rechazadas" },
  { value: "anulado", label: "Anuladas" },
] as const

/** Lo que el listado le cuenta al usuario tras una accion. `venta` solo si la anulacion quedo hecha: ahi se vuelve a facturar. */
interface AvisoListado {
  tono: "success" | "warning" | "error"
  texto: string
  detalle?: string
  venta?: { id: string; numero: number | null }
}

const BANNER: Record<AvisoListado["tono"], { tone: BannerTone; icon: typeof AlertTriangle }> = {
  success: { tone: "success", icon: CheckCircle2 },
  warning: { tone: "warning", icon: AlertTriangle },
  error: { tone: "danger", icon: AlertTriangle },
}

function variantEstado(estado: string) {
  if (estado === "emitido") return "successSoft" as const
  if (estado === "rechazado") return "destructiveSoft" as const
  // Una factura anulada ya no esta vigente pero tampoco fallo: neutra.
  if (estado === "anulado") return "secondary" as const
  return "warningSoft" as const
}

function urlListado(page: number, estado: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(LIMITE) })
  if (estado !== TODOS) params.set("estado", estado)
  return `/api/facturacion-electronica/comprobantes?${params.toString()}`
}

const idFila = (id: string) => `comprobante-${id}`

/** Anular termino sin saber si ARCA emitio la nota (502 a verificar, 500 con CAE, conexion cortada). */
const esResultadoIncierto = (r: ResultadoAnulacion) =>
  r.kind === "incierta" || r.kind === "autorizadaSinRegistrar" || r.kind === "sinConexion"

const ventaDe = (c: ComprobanteFiscalDTO) => (c.ventaId ? { id: c.ventaId, numero: c.numeroVenta } : undefined)

export function ComprobantesArcaList() {
  const { formatPrice, formatDate } = useCurrency()
  const [estado, setEstado] = useState<string>(TODOS)
  const [page, setPage] = useState(1)
  const [datos, setDatos] = useState<ListadoComprobantesResponse | null>(null)
  const [cargando, setCargando] = useState(true)
  const [fallo, setFallo] = useState(false)
  const [aviso, setAviso] = useState<AvisoListado | null>(null)
  const [verificandoId, setVerificandoId] = useState<string | null>(null)
  // Facturas cuyo ultimo intento de anular termino sin saber si ARCA emitio la nota: no se vuelve a ofrecer
  // anular hasta que el listado muestre la nota en curso o la factura anulada (el servidor tambien lo frena).
  const [inciertas, setInciertas] = useState<ReadonlySet<string>>(new Set())
  // Cada cambio de este contador pide mover el foco al resultado (cuando ya cerro el dialogo y la lista se recargo).
  const [pedidoFoco, setPedidoFoco] = useState(0)
  const avisoRef = useRef<HTMLDivElement>(null)
  const tituloRef = useRef<HTMLHeadingElement>(null)
  // `abierto` va aparte de la factura para que el dialogo conserve su contenido mientras se cierra.
  const [dialogo, setDialogo] = useState<{ factura: ComprobanteFiscalDTO; abierto: boolean } | null>(null)
  // Una respuesta lenta de un filtro viejo no debe pisar la del filtro actual.
  const pedidoActual = useRef(0)
  // El estado se actualiza en el render siguiente: el ref frena un segundo click inmediato.
  const verificandoRef = useRef(false)

  const cargar = useCallback(async () => {
    const pedido = ++pedidoActual.current
    setCargando(true)
    setFallo(false)
    // Si la pagina quedo vacia se pide otra enseguida: no se habilitan las acciones en el medio.
    let sigueCargando = false
    try {
      const res = await fetch(urlListado(page, estado))
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as ListadoComprobantesResponse
      if (pedido !== pedidoActual.current) return
      // Anular saca filas de un filtro: si la pagina quedo vacia, se vuelve a la ultima que existe.
      if (page > 1 && data.items.length === 0) {
        sigueCargando = true
        setPage(Math.max(1, data.totalPages))
        return
      }
      setDatos(data)
      setInciertas((previas) => {
        if (previas.size === 0) return previas
        const quedan = new Set(previas)
        for (const c of data.items) {
          if (quedan.has(c.id) && (c.notaCreditoEnCursoId || c.estado === "anulado")) quedan.delete(c.id)
        }
        return quedan.size === previas.size ? previas : quedan
      })
    } catch {
      if (pedido !== pedidoActual.current) return
      setFallo(true)
    } finally {
      if (pedido === pedidoActual.current && !sigueCargando) setCargando(false)
    }
  }, [page, estado])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const cambiarEstado = (valor: string) => {
    setEstado(valor || TODOS)
    setPage(1)
  }

  const verificar = async (nota: ComprobanteFiscalDTO) => {
    if (verificandoRef.current) return
    verificandoRef.current = true
    setVerificandoId(nota.id)
    setAviso(null)
    try {
      const resultado = await verificarNotaCreditoArca(nota.id)
      if (resultado.kind === "ok") setAviso({ tono: "success", texto: resultado.message, venta: ventaDe(nota) })
      else setAviso(avisoDeVerificacion(resultado))
      // Pase lo que pase se vuelve a leer: el servidor es la fuente de verdad.
      await cargar()
      setPedidoFoco((n) => n + 1)
    } finally {
      verificandoRef.current = false
      setVerificandoId(null)
    }
  }

  // El dialogo avisa de todo desenlace que cambia (o pudo cambiar) la factura.
  const anulacionTerminada = async (factura: ComprobanteFiscalDTO, resultado: ResultadoAnulacion) => {
    if (esResultadoIncierto(resultado)) setInciertas((previas) => new Set(previas).add(factura.id))
    if (resultado.kind === "ok") {
      setAviso({
        tono: "success",
        texto: mensajeFacturaAnulada(resultado.comprobante),
        detalle: resultado.fueraDePlazo ? AVISO_FUERA_DE_PLAZO : undefined,
        venta: ventaDe(factura),
      })
    } else {
      setAviso(avisoDeAnulacion(resultado))
    }
    await cargar()
    setPedidoFoco((n) => n + 1)
  }

  // Ya cerrado el dialogo y recargada la lista, el resultado tiene que ser lo primero que se lea y se vea.
  useEffect(() => {
    if (pedidoFoco === 0) return
    const timer = setTimeout(() => {
      const destino = avisoRef.current?.dataset.vacio === "true" ? tituloRef.current : avisoRef.current
      destino?.focus({ preventScroll: true })
      destino?.scrollIntoView?.({ block: "nearest" })
    }, 0)
    return () => clearTimeout(timer)
  }, [pedidoFoco])

  const irANota = (id: string) => {
    const fila = document.getElementById(idFila(id))
    fila?.focus({ preventScroll: true })
    fila?.scrollIntoView?.({ block: "nearest" })
  }

  const items = datos?.items ?? []
  const totalPages = datos?.totalPages ?? 0
  // Mientras ARCA contesta una verificacion (o se recarga la lista) no se dispara otra accion fiscal.
  const accionesBloqueadas = verificandoId !== null || cargando

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <Select value={estado} onValueChange={cambiarEstado}>
          <SelectTrigger className="w-full sm:w-auto sm:min-w-[200px]" aria-label="Filtrar por estado">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            {FILTROS_ESTADO.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <h2 ref={tituloRef} tabIndex={-1} className="sr-only">
        Comprobantes ARCA
      </h2>
      <AvisoAccion ref={avisoRef} aviso={aviso} onCerrar={() => setAviso(null)} />

      {fallo ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <p className="text-destructive">No pudimos cargar las facturas. Probá de nuevo en un momento.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void cargar()}>
            Reintentar
          </Button>
        </div>
      ) : cargando && !datos ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4 flex gap-4">
              <div className="h-4 bg-muted animate-pulse rounded w-24" />
              <div className="h-4 bg-muted animate-pulse rounded flex-1" />
              <div className="h-4 bg-muted animate-pulse rounded w-16" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {estado === TODOS ? "Todavía no hay facturas electrónicas" : "No hay facturas con ese estado"}
          </CardContent>
        </Card>
      ) : (
        <Card className={cargando ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background">
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium hidden md:table-cell">Fecha</th>
                  <th className="text-left p-3 font-medium">Comprobante</th>
                  <th className="text-left p-3 font-medium">Venta</th>
                  <th className="text-right p-3 font-medium">Total</th>
                  <th className="text-center p-3 font-medium">Estado</th>
                  <th className="text-left p-3 font-medium hidden lg:table-cell">CAE</th>
                  <th className="text-center p-3 font-medium">PDF</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <FilaComprobante
                    key={c.id}
                    c={c}
                    formatPrice={formatPrice}
                    formatDate={formatDate}
                    accionesBloqueadas={accionesBloqueadas}
                    verificando={verificandoId === c.id}
                    notaEnPagina={c.notaCreditoEnCursoId ? items.some((n) => n.id === c.notaCreditoEnCursoId) : false}
                    incierta={inciertas.has(c.id)}
                    onIrANota={irANota}
                    onAnular={(factura) => setDialogo({ factura, abierto: true })}
                    onVerificar={verificar}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!fallo && totalPages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1 || cargando} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {datos?.page ?? page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || cargando}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      )}

      {dialogo && (
        <AnularFacturaDialog
          open={dialogo.abierto}
          onOpenChange={(abierto) => setDialogo((actual) => actual && { ...actual, abierto })}
          factura={dialogo.factura}
          onResultado={(resultado) => void anulacionTerminada(dialogo.factura, resultado)}
        />
      )}
    </div>
  )
}

/**
 * Resultado de la ultima accion fiscal. Queda hasta que se cierra o se hace otra: un toast se iria antes de poder
 * tocar el link. La region en vivo esta siempre montada y solo cambia su texto, para que los lectores de pantalla
 * anuncien el cambio; los errores usan role="alert", que se anuncia al aparecer.
 */
function AvisoAccion({
  aviso,
  onCerrar,
  ref,
}: {
  aviso: AvisoListado | null
  onCerrar: () => void
  ref: Ref<HTMLDivElement>
}) {
  const banner = aviso && (
    <StatusBanner tone={BANNER[aviso.tono].tone} icon={BANNER[aviso.tono].icon} className="items-start font-normal">
      <span className="block">{aviso.texto}</span>
      {aviso.detalle && <span className="mt-1 block">{aviso.detalle}</span>}
      {aviso.venta && (
        <span className="mt-1 block">
          Para volver a facturarla,{" "}
          <Link href={`/ventas/${aviso.venta.id}`} className="font-medium underline underline-offset-2">
            {aviso.venta.numero != null
              ? `abrí la venta V${String(aviso.venta.numero).padStart(4, "0")}`
              : "abrí la venta"}
          </Link>
          .
        </span>
      )}
    </StatusBanner>
  )
  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-testid="aviso-comprobantes"
      data-vacio={aviso === null}
      className={aviso ? "flex items-start gap-2 outline-none" : "outline-none"}
    >
      <div role="status" aria-live="polite" className="min-w-0 flex-1 empty:hidden">
        {aviso && aviso.tono !== "error" ? banner : null}
      </div>
      {aviso?.tono === "error" && (
        <div role="alert" className="min-w-0 flex-1">
          {banner}
        </div>
      )}
      {aviso && (
        <Button variant="ghost" size="icon" aria-label="Cerrar aviso" onClick={onCerrar}>
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}

interface FilaComprobanteProps {
  c: ComprobanteFiscalDTO
  formatPrice: (n: number | string | null | undefined) => string
  formatDate: (d: Date | string | null | undefined) => string
  accionesBloqueadas: boolean
  verificando: boolean
  /** La nota de credito en curso de esta factura esta en la misma pagina. */
  notaEnPagina: boolean
  /** Se intento anular y no se sabe si ARCA emitio la nota: no se vuelve a ofrecer. */
  incierta: boolean
  onIrANota: (id: string) => void
  onAnular: (factura: ComprobanteFiscalDTO) => void
  onVerificar: (nota: ComprobanteFiscalDTO) => void
}

function FilaComprobante({
  c,
  formatPrice,
  formatDate,
  accionesBloqueadas,
  verificando,
  notaEnPagina,
  incierta,
  onIrANota,
  onAnular,
  onVerificar,
}: FilaComprobanteProps) {
  // Una factura anulada sigue siendo un comprobante emitido: conserva su PDF.
  const tienePdf = c.estado === "emitido" || c.estado === "anulado"
  const nombre = [c.tipo, c.numero].filter(Boolean).join(" ")
  return (
    <tr id={idFila(c.id)} tabIndex={-1} className="border-b hover:bg-muted/30 transition-colors outline-none">
      <td className="p-3 text-muted-foreground hidden md:table-cell">
        {c.fechaEmision ? fechaFiscalDMA(c.fechaEmision) : formatDate(c.createdAt)}
      </td>
      <td className="p-3">
        {c.numero ? (
          <div className="font-medium">{c.numero}</div>
        ) : (
          <div className="text-muted-foreground">Sin número</div>
        )}
        <div className="text-xs text-muted-foreground">{tituloComprobante(c.tipo, null, c.esNotaCredito)}</div>
        {c.estado === "rechazado" && c.errorMsg && (
          <div className="mt-1 text-xs text-destructive">{c.errorMsg}</div>
        )}
        {/* Las acciones viven en la celda principal: Fecha y CAE se esconden en pantallas chicas. */}
        {c.anulable && !incierta && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            aria-label={`Anular factura ${nombre}`}
            disabled={accionesBloqueadas}
            onClick={() => onAnular(c)}
          >
            Anular factura
          </Button>
        )}
        {c.verificable && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            aria-label={`${verificando ? "Verificando" : "Verificar"} con ARCA la nota de crédito electrónica ${nombre}`}
            disabled={accionesBloqueadas}
            onClick={() => onVerificar(c)}
          >
            {verificando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Verificando...
              </>
            ) : (
              "Verificar con ARCA"
            )}
          </Button>
        )}
        {!c.esNotaCredito && (c.notaCreditoEnCursoId || incierta) && (
          <div className="mt-1 text-xs text-warning-700 dark:text-warning-600">
            {notaEnPagina && c.notaCreditoEnCursoId ? (
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => onIrANota(c.notaCreditoEnCursoId!)}
              >
                Nota de crédito en curso
              </button>
            ) : (
              <>
                <div>Nota de crédito en curso</div>
                <div>Verificala con ARCA desde la nota.</div>
              </>
            )}
          </div>
        )}
      </td>
      <td className="p-3">
        {c.ventaId && c.numeroVenta != null ? (
          <Link href={`/ventas/${c.ventaId}`} className="hover:underline">
            V{String(c.numeroVenta).padStart(4, "0")}
          </Link>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
      <td className="p-3 text-right font-medium">
        {c.total != null ? `${c.esNotaCredito ? "-" : ""}${formatPrice(c.total)}` : "-"}
      </td>
      <td className="p-3 text-center">
        <Badge variant={variantEstado(c.estado)}>{etiquetaEstadoComprobante(c.estado)}</Badge>
      </td>
      <td className="p-3 font-mono text-xs hidden lg:table-cell">{c.cae ?? "-"}</td>
      <td className="p-3 text-center">
        {tienePdf && c.pdfDisponible ? (
          <Button asChild variant="outline" size="sm">
            <a href={pdfComprobanteHref(c.id)} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1 h-4 w-4" />
              Ver PDF
            </a>
          </Button>
        ) : tienePdf ? (
          <span className="text-xs text-muted-foreground">PDF no disponible: datos incompletos</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
    </tr>
  )
}
