"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import useSWR from "swr"
import {
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  FileText,
  MessageCircle,
  MessageSquareWarning,
  Search,
  SearchX,
  ShieldCheck,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ETIQUETA_ORIGEN,
  ETIQUETA_TAB,
  TABS_GARANTIAS,
  VENTANA_POR_VENCER_DIAS,
  textoVencimiento,
  type OrigenGarantia,
  type TabGarantias,
} from "@/lib/garantias/estado"
import type { ConteosGarantias, GarantiaListada } from "@/lib/garantias/listado"
import { cn } from "@/lib/utils"
import { EstadoGarantiaPill } from "./estado-garantia-pill"
import { RegistrarReclamoDialog } from "./registrar-reclamo-dialog"
import { DecidirReclamoDialog, type AccionReclamo, type DecidirReclamoDialogProps } from "./decidir-reclamo-dialog"
import { FaseReclamoBadge } from "./reclamos-timeline"

export interface RespuestaGarantias {
  data: GarantiaListada[]
  total: number
  page: number
  limit: number
  totalPages: number
  conteos: ConteosGarantias | null
  hoy: string
  ventana: number
  sucursal: string | null
  soloLectura: boolean
}

interface SucursalOpt {
  id: string
  nombre: string
}

const fetcher = async (url: string): Promise<RespuestaGarantias> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error("No se pudieron cargar las garantías")
  return res.json()
}

const TODOS = "all"

export { EstadoGarantiaPill }

function textoVacio(tab: TabGarantias, ventana: number): { titulo: string; descripcion: string } {
  switch (tab) {
    case "por-vencer":
      return {
        titulo: "No hay garantías por vencer",
        descripcion: `Ninguna garantía vence en los próximos ${ventana} días.`,
      }
    case "reclamos":
      return { titulo: "No hay reclamos abiertos", descripcion: "Cuando un cliente reclame una garantía, lo vas a ver acá." }
    case "vigentes":
      return { titulo: "No hay garantías vigentes", descripcion: "Las garantías nacen al entregar una reparación o al vender un producto con garantía." }
    case "vencidas":
      return { titulo: "No hay garantías vencidas ni anuladas", descripcion: "Todavía no venció ninguna garantía." }
  }
}

function Vencimiento({ g }: { g: GarantiaListada }) {
  const fecha = g.diaVencimiento.split("-").reverse().join("/")
  const urgente = g.estado === "POR_VENCER"
  return (
    <div className="text-sm">
      <div className={cn(urgente ? "font-medium text-warning-700 dark:text-warning-500" : "text-foreground")}>
        {textoVencimiento(g.diasRestantes)}
      </div>
      <div className="text-xs text-muted-foreground">{fecha}</div>
    </div>
  )
}

function Referencia({ g }: { g: GarantiaListada }) {
  const etiqueta = `${g.referencia.tipo === "VENTA" ? "Venta" : "Orden"} ${g.referencia.numero}`
  return (
    <div className="text-sm">
      {g.acciones.verHref ? (
        <Link href={g.acciones.verHref} className="text-primary hover:underline">
          {etiqueta}
        </Link>
      ) : (
        <span>{etiqueta}</span>
      )}
      {g.numeroGarantia ? <div className="font-mono text-xs text-muted-foreground">{g.numeroGarantia}</div> : null}
    </div>
  )
}

interface AccionesProps {
  g: GarantiaListada
  compacto?: boolean
  onRegistrar: (g: GarantiaListada) => void
  onDecidir: (g: GarantiaListada, accion: AccionReclamo) => void
}

function Acciones({ g, compacto = false, onRegistrar, onDecidir }: AccionesProps) {
  const { verHref, certificadoUrl, whatsappUrl, registrarReclamo, decidirReclamo } = g.acciones
  const tam = compacto ? "sm" : "default"
  // 44 px en pantallas táctiles, también en la tabla compacta.
  const tactil = "min-h-11"
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {decidirReclamo && g.reclamo && (
        <>
          <Button size={tam} variant="outline" className={cn(tactil, "gap-1.5")} onClick={() => onDecidir(g, "aceptar")}>
            <CheckCircle className="h-4 w-4" aria-hidden="true" />
            Aceptar
          </Button>
          <Button
            size={tam}
            variant="outline"
            className={cn(tactil, "gap-1.5 text-destructive-text")}
            onClick={() => onDecidir(g, "rechazar")}
          >
            <XCircle className="h-4 w-4" aria-hidden="true" />
            Rechazar
          </Button>
        </>
      )}
      {registrarReclamo && (
        <Button size={tam} variant="outline" className={cn(tactil, "gap-1.5")} onClick={() => onRegistrar(g)}>
          <MessageSquareWarning className="h-4 w-4" aria-hidden="true" />
          Registrar reclamo
        </Button>
      )}
      {g.reclamo?.ordenReingreso && (
        <Button asChild size={tam} variant="ghost" className={cn(tactil, "gap-1.5")}>
          <Link href={`/ordenes/${g.reclamo.ordenReingreso.id}`}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {g.reclamo.ordenReingreso.numero ? `Re-ingreso ${g.reclamo.ordenReingreso.numero}` : "Ver re-ingreso"}
          </Link>
        </Button>
      )}
      {verHref && (
        <Button asChild size={tam} variant="ghost" className={cn(tactil, "gap-1.5")}>
          <Link href={verHref}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {g.referencia.tipo === "VENTA" ? "Ver venta" : "Ver orden"}
          </Link>
        </Button>
      )}
      {certificadoUrl && (
        <Button asChild size={tam} variant="ghost" className={cn(tactil, "gap-1.5")}>
          <a href={certificadoUrl} target="_blank" rel="noopener noreferrer">
            <FileText className="h-4 w-4" aria-hidden="true" />
            {g.referencia.tipo === "VENTA" ? "Certificado PDF" : "Comprobante PDF"}
          </a>
        </Button>
      )}
      {whatsappUrl && (
        <Button asChild size={tam} variant="ghost" className={cn(tactil, "gap-1.5")}>
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" aria-label={`Escribirle por WhatsApp a ${g.cliente.nombre}`}>
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            WhatsApp
          </a>
        </Button>
      )}
    </div>
  )
}

function ReclamoResumen({ g }: { g: GarantiaListada }) {
  if (!g.reclamo) return null
  return (
    <div className="min-w-0 space-y-1">
      <FaseReclamoBadge fase={g.reclamo.fase} />
      <p className="line-clamp-2 text-sm text-muted-foreground">{g.reclamo.descripcion}</p>
    </div>
  )
}

/**
 * Lista unificada de garantías (reparación + venta). Todo el estado vive en
 * la URL (?tab, ?origen, ?sucursal, ?q, ?page) para que el link del dashboard
 * y el botón de Ventas abran la vista exacta.
 */
export function GarantiasList() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const esAdmin = session?.user?.role === "ADMIN"

  const tabParam = searchParams.get("tab")
  const tab: TabGarantias = (TABS_GARANTIAS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as TabGarantias)
    : "por-vencer"
  const origenParam = searchParams.get("origen")
  const origen = origenParam === "REPARACION" || origenParam === "VENTA" ? (origenParam as OrigenGarantia) : ""
  const sucursal = searchParams.get("sucursal") ?? ""
  const q = searchParams.get("q") ?? ""
  const page = Math.max(Number.parseInt(searchParams.get("page") ?? "1", 10) || 1, 1)
  const [pageSize, setPageSize] = useState(20)

  const actualizar = useCallback(
    (cambios: Record<string, string | null>, resetPage = true) => {
      const p = new URLSearchParams(searchParams.toString())
      for (const [k, v] of Object.entries(cambios)) {
        if (v) p.set(k, v)
        else p.delete(k)
      }
      if (resetPage) p.delete("page")
      const qs = p.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  // Búsqueda con debounce: el input es local, la URL se actualiza a los 300 ms.
  // Si la URL cambia por fuera (atrás, "Limpiar filtros"), el input la sigue.
  const [busqueda, setBusqueda] = useState(q)
  const [qPrevio, setQPrevio] = useState(q)
  if (q !== qPrevio) {
    setQPrevio(q)
    setBusqueda(q)
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onBuscar = (valor: string) => {
    setBusqueda(valor)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => actualizar({ q: valor.trim() || null }), 300)
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const url = useMemo(() => {
    const p = new URLSearchParams()
    p.set("tab", tab)
    if (origen) p.set("origen", origen)
    if (sucursal) p.set("sucursal", sucursal)
    if (q) p.set("q", q)
    p.set("page", String(page))
    p.set("limit", String(pageSize))
    return `/api/garantias/unificadas?${p.toString()}`
  }, [tab, origen, sucursal, q, page, pageSize])

  const { data, error, isLoading, mutate } = useSWR<RespuestaGarantias>(url, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  })

  const { data: sucursalesResp } = useSWR<{ data: SucursalOpt[] }>(
    esAdmin ? "/api/sucursales" : null,
    async (u: string) => {
      const res = await fetch(u)
      if (!res.ok) throw new Error("sucursales")
      return res.json()
    },
    { revalidateOnFocus: false }
  )
  const sucursales = sucursalesResp?.data ?? []

  const [registrar, setRegistrar] = useState<GarantiaListada | null>(null)
  const [decision, setDecision] = useState<DecidirReclamoDialogProps["pendiente"]>(null)
  const detalleDe = (g: GarantiaListada) => `${g.descripcion} · ${g.cliente.nombre}`
  const onRegistrar = (g: GarantiaListada) => setRegistrar(g)
  const onDecidir = (g: GarantiaListada, accion: AccionReclamo) => {
    if (!g.reclamo) return
    setDecision({ reclamoId: g.reclamo.id, accion, descripcion: g.reclamo.descripcion, detalle: detalleDe(g) })
  }

  const filas = data?.data ?? []
  const total = data?.total ?? 0
  const conteos = data?.conteos ?? null
  const ventana = data?.ventana ?? VENTANA_POR_VENCER_DIAS
  const hayFiltros = Boolean(q || origen || (sucursal && sucursal !== "todas"))

  const limpiar = () => {
    setBusqueda("")
    actualizar({ q: null, origen: null, sucursal: null })
  }

  const columnas: Column<GarantiaListada>[] = [
    {
      key: "cliente",
      header: "Cliente",
      render: (g) => (
        <div className="min-w-0">
          <div className="font-medium">{g.cliente.nombre}</div>
          {g.cliente.telefono ? <div className="text-xs text-muted-foreground">{g.cliente.telefono}</div> : null}
        </div>
      ),
    },
    {
      key: "descripcion",
      header: "Equipo o producto",
      render: (g) => (
        <div className="min-w-0">
          <div className="line-clamp-2">{g.descripcion}</div>
          <div className="text-xs text-muted-foreground">
            {ETIQUETA_ORIGEN[g.origen]}
            {g.sucursal?.nombre && esAdmin && (!sucursal || sucursal === "todas") ? ` · ${g.sucursal.nombre}` : ""}
          </div>
        </div>
      ),
    },
    { key: "referencia", header: "Orden o venta", hideOnTablet: true, render: (g) => <Referencia g={g} /> },
    tab === "reclamos"
      ? { key: "reclamo", header: "Reclamo", render: (g) => <ReclamoResumen g={g} /> }
      : { key: "vencimiento", header: "Vencimiento", render: (g) => <Vencimiento g={g} /> },
    { key: "estado", header: "Estado", render: (g) => <EstadoGarantiaPill estado={g.estado} /> },
    {
      key: "acciones",
      header: "",
      render: (g) => <Acciones g={g} compacto onRegistrar={onRegistrar} onDecidir={onDecidir} />,
    },
  ]

  const tarjeta = (g: GarantiaListada) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{g.cliente.nombre}</div>
          <div className="text-sm text-muted-foreground line-clamp-2">{g.descripcion}</div>
        </div>
        <EstadoGarantiaPill estado={g.estado} />
      </div>
      {g.reclamo ? <ReclamoResumen g={g} /> : null}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Vencimiento g={g} />
        <div className="text-right text-xs text-muted-foreground">
          <div>{ETIQUETA_ORIGEN[g.origen]}</div>
          <Referencia g={g} />
        </div>
      </div>
      <Acciones g={g} onRegistrar={onRegistrar} onDecidir={onDecidir} />
    </div>
  )

  const cargandoPrimeraVez = isLoading && !data
  const errorSinDatos = error && !data

  let contenido: ReactNode
  if (errorSinDatos) {
    contenido = (
      <div className="rounded-lg border bg-card">
        <EmptyState
          icon={AlertTriangle}
          variant="error"
          title="No pudimos cargar las garantías"
          description="Revisá tu conexión y volvé a intentar."
          action={{ label: "Reintentar", onClick: () => void mutate() }}
        />
      </div>
    )
  } else if (!cargandoPrimeraVez && filas.length === 0) {
    const vacio = textoVacio(tab, ventana)
    contenido = (
      <div className="rounded-lg border bg-card">
        {hayFiltros ? (
          <EmptyState
            icon={SearchX}
            variant="search"
            title="Sin resultados"
            description="Ninguna garantía de esta pestaña coincide con la búsqueda o los filtros."
            action={{ label: "Limpiar filtros", onClick: limpiar }}
          />
        ) : (
          <EmptyState icon={ShieldCheck} title={vacio.titulo} description={vacio.descripcion} />
        )}
      </div>
    )
  } else {
    contenido = (
      <DataTable
        data={filas}
        columns={columnas}
        keyExtractor={(g) => `${g.origen}-${g.id}`}
        loading={cargandoPrimeraVez}
        renderMobileCard={tarjeta}
        pagination={{
          page,
          pageSize,
          total,
          onPageChange: (p) => actualizar({ page: p > 1 ? String(p) : null }, false),
          onPageSizeChange: (s) => {
            setPageSize(s)
            actualizar({})
          },
        }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => actualizar({ tab: v === "por-vencer" ? null : v })}>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList aria-label="Estado de las garantías" className="w-max justify-start">
            {TABS_GARANTIAS.map((t) => (
              <TabsTrigger key={t} value={t} className="gap-1.5">
                {ETIQUETA_TAB[t]}
                {conteos ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-xs tabular-nums",
                      t === tab ? "bg-primary/10 text-primary" : "bg-background/70"
                    )}
                  >
                    {conteos[t]}
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Buscar garantías"
            placeholder="Buscar por cliente, teléfono, orden, venta o certificado"
            value={busqueda}
            onChange={(e) => onBuscar(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={origen || TODOS} onValueChange={(v) => actualizar({ origen: v === TODOS ? null : v })}>
          <SelectTrigger aria-label="Origen" className="w-full sm:w-44">
            <SelectValue placeholder="Origen" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Reparaciones y ventas</SelectItem>
            <SelectItem value="REPARACION">Solo reparaciones</SelectItem>
            <SelectItem value="VENTA">Solo ventas</SelectItem>
          </SelectContent>
        </Select>
        {esAdmin && sucursales.length > 1 && (
          <Select
            value={sucursal || data?.sucursal || "todas"}
            onValueChange={(v) => actualizar({ sucursal: v })}
          >
            <SelectTrigger aria-label="Sucursal" className="w-full sm:w-48">
              <SelectValue placeholder="Sucursal" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las sucursales</SelectItem>
              {sucursales.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {tab === "por-vencer" && !errorSinDatos ? (
        <p className="text-sm text-muted-foreground">
          Vencen hoy o en los próximos {ventana} días. Las fechas son las de tu taller.
        </p>
      ) : null}

      {contenido}

      {registrar && registrar.acciones.registrarReclamo ? (
        <RegistrarReclamoDialog
          open
          onOpenChange={(abierto) => {
            if (!abierto) setRegistrar(null)
          }}
          origen={registrar.origen}
          garantiaId={registrar.id}
          detalle={detalleDe(registrar)}
          modo={registrar.acciones.registrarReclamo}
          onRegistrado={() => {
            setRegistrar(null)
            void mutate()
          }}
        />
      ) : null}
      <DecidirReclamoDialog pendiente={decision} onClose={() => setDecision(null)} onDecidido={() => void mutate()} />

      {error && data ? (
        <p role="status" className="text-sm text-destructive-text">
          No pudimos actualizar la lista.{" "}
          <button type="button" className="font-medium underline" onClick={() => void mutate()}>
            Reintentar
          </button>
        </p>
      ) : null}
    </div>
  )
}
