"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { Filter, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { DatePicker } from "@/components/ui/date-picker"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCurrency } from "@/contexts/currency-context"
import { MOTIVOS_NC, MOTIVO_NC_LABELS, MODO_NC_LABELS, ORIGEN_NC_LABELS } from "@/lib/notas-credito/catalogo"
import type { NotaCreditoFila } from "@/lib/notas-credito/listado"
import { NotaCreditoAcciones } from "./nota-credito-acciones"

interface RespuestaListado {
  data: NotaCreditoFila[]
  total: number
}

const fetcher = async (url: string): Promise<RespuestaListado> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error("No se pudieron cargar las notas de crédito")
  return res.json()
}

const TODOS = "all"

const OPCIONES_ORIGEN = Object.entries(ORIGEN_NC_LABELS) as Array<[string, string]>
const OPCIONES_MODO = Object.entries(MODO_NC_LABELS) as Array<[string, string]>
const OPCIONES_MOTIVO = MOTIVOS_NC.map((m) => [m, MOTIVO_NC_LABELS[m]] as [string, string])
const OPCIONES_ESTADO: Array<[string, string]> = [["ACTIVA", "Activas"], ["ANULADA", "Anuladas"]]

const hrefOperacion = (f: NotaCreditoFila) => (f.origen === "VENTA" ? `/ventas/${f.origenId}` : `/ordenes/${f.origenId}`)

function FiltroSelect({
  id,
  label,
  value,
  onChange,
  opciones,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  opciones: Array<[string, string]>
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>
      <Select value={value || TODOS} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Todos" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todos</SelectItem>
          {opciones.map(([valor, etiqueta]) => (
            <SelectItem key={valor} value={valor}>{etiqueta}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/**
 * Listado de notas de crédito de los dos motores (v_notas_credito), con
 * anuladas e historial DEV-. La sucursal la decide el selector global; el
 * cliente llega por ?cliente= desde su ficha.
 */
export function NotasCreditoList({ clienteId }: { clienteId: string | null }) {
  const { formatPrice, formatDate } = useCurrency()

  const [busqueda, setBusqueda] = useState("")
  const [q, setQ] = useState("")
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")
  const [origen, setOrigen] = useState("")
  const [modo, setModo] = useState("")
  const [motivo, setMotivo] = useState("")
  const [estado, setEstado] = useState("")
  const [verFiltros, setVerFiltros] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onBuscar = useCallback((valor: string) => {
    setBusqueda(valor)
    setPage(1)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setQ(valor.trim()), 300)
  }, [])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const url = useMemo(() => {
    const p = new URLSearchParams()
    if (clienteId) p.set("cliente", clienteId)
    if (q) p.set("q", q)
    if (desde) p.set("desde", desde)
    if (hasta) p.set("hasta", hasta)
    if (origen) p.set("origen", origen)
    if (modo) p.set("modo", modo)
    if (motivo) p.set("motivo", motivo)
    if (estado) p.set("estado", estado)
    p.set("page", String(page))
    p.set("limit", String(pageSize))
    return `/api/notas-credito?${p.toString()}`
  }, [clienteId, q, desde, hasta, origen, modo, motivo, estado, page, pageSize])

  const { data, error, isLoading } = useSWR<RespuestaListado>(url, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  const filas = data?.data ?? []
  const total = data?.total ?? 0

  const hayFiltros = Boolean(q || desde || hasta || origen || modo || motivo || estado)
  const cambiar = (set: (v: string) => void) => (v: string) => {
    set(v === TODOS ? "" : v)
    setPage(1)
  }
  const limpiar = () => {
    setBusqueda("")
    setQ("")
    setDesde("")
    setHasta("")
    setOrigen("")
    setModo("")
    setMotivo("")
    setEstado("")
    setPage(1)
  }

  const operacion = (f: NotaCreditoFila) => (
    <Link href={hrefOperacion(f)} className="text-primary hover:underline">
      {ORIGEN_NC_LABELS[f.origen]} {f.origenNumero}
    </Link>
  )
  const monto = (f: NotaCreditoFila) => (
    <span className={f.anulada ? "text-muted-foreground line-through" : "font-medium"}>{formatPrice(f.monto)}</span>
  )

  const columnas: Column<NotaCreditoFila>[] = [
    {
      key: "numero",
      header: "Número",
      render: (f) => (
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium">{f.numero}</span>
          {f.anulada ? <Badge variant="destructive">Anulada</Badge> : null}
        </div>
      ),
    },
    { key: "fecha", header: "Fecha", render: (f) => formatDate(f.fecha) },
    { key: "origen", header: "Origen", render: operacion },
    { key: "cliente", header: "Cliente", render: (f) => f.clienteNombre },
    {
      key: "motivo",
      header: "Motivo",
      hideOnTablet: true,
      render: (f) => <span className="text-muted-foreground">{f.motivo}</span>,
    },
    { key: "monto", header: "Monto", className: "text-right", headerClassName: "text-right", render: monto },
    { key: "acciones", header: "", render: (f) => <NotaCreditoAcciones id={f.id} compacto anulada={f.anulada} /> },
  ]

  // DataTable ya envuelve cada tarjeta mobile en su propio recuadro.
  const tarjeta = (f: NotaCreditoFila) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-medium">{f.numero}</span>
        {monto(f)}
      </div>
      <div className="text-sm">{f.clienteNombre}</div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{formatDate(f.fecha)}</span>
        {operacion(f)}
        {f.anulada ? <Badge variant="destructive">Anulada</Badge> : null}
      </div>
      <div className="text-xs text-muted-foreground">{f.motivo}</div>
      <NotaCreditoAcciones id={f.id} anulada={f.anulada} />
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar por número"
            placeholder="Buscar por número (NC-000123)"
            value={busqueda}
            onChange={(e) => onBuscar(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={() => setVerFiltros((v) => !v)}>
          <Filter className="mr-2 h-4 w-4" />
          Filtros
        </Button>
      </div>

      {clienteId ? (
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="secondary">Filtrado por cliente</Badge>
          <Link href="/notas-credito" className="text-primary hover:underline">Ver todas</Link>
        </div>
      ) : null}

      {verFiltros ? (
        <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="nc-filtro-desde" className="mb-1.5 block text-sm font-medium">Desde</label>
            <DatePicker id="nc-filtro-desde" value={desde} onChange={(v) => { setDesde(v || ""); setPage(1) }} />
          </div>
          <div>
            <label htmlFor="nc-filtro-hasta" className="mb-1.5 block text-sm font-medium">Hasta</label>
            <DatePicker id="nc-filtro-hasta" value={hasta} onChange={(v) => { setHasta(v || ""); setPage(1) }} />
          </div>
          <FiltroSelect id="nc-filtro-origen" label="Origen" value={origen} onChange={cambiar(setOrigen)} opciones={OPCIONES_ORIGEN} />
          <FiltroSelect id="nc-filtro-modo" label="Tipo" value={modo} onChange={cambiar(setModo)} opciones={OPCIONES_MODO} />
          <FiltroSelect id="nc-filtro-motivo" label="Motivo" value={motivo} onChange={cambiar(setMotivo)} opciones={OPCIONES_MOTIVO} />
          <FiltroSelect id="nc-filtro-estado" label="Estado" value={estado} onChange={cambiar(setEstado)} opciones={OPCIONES_ESTADO} />
          {hayFiltros ? (
            <div className="flex items-end">
              <Button variant="ghost" onClick={limpiar} className="w-full">
                <X className="mr-2 h-4 w-4" />
                Limpiar filtros
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          No se pudieron cargar las notas de crédito. Probá de nuevo en unos segundos.
        </p>
      ) : null}

      <DataTable
        data={filas}
        columns={columnas}
        loading={isLoading}
        keyExtractor={(f) => f.id}
        emptyMessage={hayFiltros || clienteId ? "No hay notas de crédito con estos filtros" : "Todavía no hay notas de crédito"}
        renderMobileCard={tarjeta}
        pagination={{
          page,
          pageSize,
          total,
          onPageChange: setPage,
          onPageSizeChange: (n) => {
            setPageSize(n)
            setPage(1)
          },
        }}
      />
    </div>
  )
}
