"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react"
import { CajaSessionBanner } from "@/components/caja/caja-session-banner"
import { AperturaDialog } from "@/components/caja/apertura-dialog"
import { CierreDialog } from "@/components/caja/cierre-dialog"
import { CajaResumen } from "@/components/caja/caja-resumen"
import { MovimientoManualForm } from "@/components/caja/movimiento-manual-form"
import { MovimientosManualesList } from "@/components/caja/movimientos-manuales-list"
import { HistorialCierres } from "@/components/caja/historial-cierres"
import { ExportButton } from "@/components/caja/export-button"
import { PageShell } from "@/components/ui/page-shell"
import { useCurrency } from "@/contexts/currency-context"
import { todayInTimeZone } from "@/lib/timezone"

export default function CajaPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const { timezone } = useCurrency()
  const role = session?.user?.role
  const isAdmin = role === "ADMIN"

  // Permiso opt-in por organización para que el VENDEDOR opere su turno.
  // `null` = todavía no se sabe, y NO es lo mismo que `false`.
  //
  // Para dibujar: fail-closed. Mientras no se sepa no se muestran controles
  // que el servidor va a rechazar con 403.
  //
  // Para expulsar: solo un `false` EXPLÍCITO rebota al panel. Un chequeo que
  // no se pudo completar —503, enlace caído, la columna sin migrar— no es una
  // negativa, y tratarlo como tal saca de la pantalla a alguien que sí tiene
  // el permiso. Dejarlo pasar no abre nada: las lecturas y escrituras de caja
  // son fail-closed del lado del servidor. Mismo criterio que PosAccessGate.
  const [permisoCaja, setPermisoCaja] = useState<boolean | null>(null)

  useEffect(() => {
    if (role !== "VENDEDOR") return
    let cancelado = false
    fetch("/api/org/features", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelado || !d) return
        setPermisoCaja(!!d.vendedoresManejanCaja)
      })
      .catch(() => {})
    return () => {
      cancelado = true
    }
  }, [role])

  // El middleware deja entrar al VENDEDOR a /caja a propósito: corre en el
  // Edge y ahí no se puede leer el flag. El rebote es acá.
  useEffect(() => {
    if (role === "VENDEDOR" && permisoCaja === false) {
      router.replace("/dashboard")
    }
  }, [role, permisoCaja, router])

  // Operativa del turno: abrir, cerrar con arqueo y movimientos manuales.
  // El histórico financiero —export CSV e historial de cierres— sigue detrás
  // de `isAdmin`: el vendedor opera SU turno, el dueño audita todos.
  const puedeOperarCaja = isAdmin || (role === "VENDEDOR" && permisoCaja === true)

  // Día de caja por defecto = hoy en la tz de la org (no el día UTC, que a las
  // 21:00 local en UTC-3 ya salta al día siguiente y muestra caja vacía).
  const [fecha, setFecha] = useState(() => todayInTimeZone(timezone))
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)
  const [filtroMetodo, setFiltroMetodo] = useState("")
  const [filtroTipo, setFiltroTipo] = useState("")
  const [aperturaOpen, setAperturaOpen] = useState(false)
  const [cierreOpen, setCierreOpen] = useState(false)
  const [movRefreshKey, setMovRefreshKey] = useState(0)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ fecha })
      if (filtroMetodo) params.append("metodoPago", filtroMetodo)
      if (filtroTipo) params.append("tipo", filtroTipo)
      const res = await fetch(`/api/caja?${params.toString()}`)
      if (res.ok) {
        setData(await res.json())
      }
    } catch (err) {
      console.error("Error fetching caja:", err)
    } finally {
      setLoading(false)
    }
  }, [fecha, filtroMetodo, filtroTipo])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const cambiarDia = (delta: number) => {
    const d = new Date(fecha)
    d.setDate(d.getDate() + delta)
    setFecha(d.toISOString().split("T")[0])
  }

  const esHoy = fecha === new Date().toISOString().split("T")[0]

  const handleSessionChange = () => {
    fetchData()
    setMovRefreshKey((k) => k + 1)
  }

  const sesionActual = data?.sesionActual || null

  return (
    <PageShell
      title="Caja Diaria"
      description="Resumen de ingresos y egresos del día"
      actions={isAdmin ? <ExportButton fecha={fecha} /> : null}
    >
      {/* Banner de sesión */}
      {puedeOperarCaja && (
        <CajaSessionBanner
          sesion={sesionActual}
          loading={loading}
          onAbrir={() => setAperturaOpen(true)}
          onCerrar={() => setCierreOpen(true)}
        />
      )}

      {/* Selector de fecha */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <Button variant="outline" size="icon" onClick={() => cambiarDia(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="w-auto"
        />
        <Button variant="outline" size="icon" onClick={() => cambiarDia(1)} disabled={esHoy}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        {!esHoy && (
          <Button variant="ghost" size="sm" onClick={() => setFecha(new Date().toISOString().split("T")[0])}>
            Hoy
          </Button>
        )}
      </div>

      {loading && !data ? (
        <div className="space-y-4">
          {/* Skeleton: summary cards */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-lg border bg-card p-4 space-y-3">
                <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                <div className="h-7 w-20 bg-muted animate-pulse rounded" />
                <div className="h-3 w-16 bg-muted animate-pulse rounded" />
              </div>
            ))}
          </div>
          {/* Skeleton: table rows */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex gap-4">
                <div className="h-4 flex-1 bg-muted animate-pulse rounded" />
                <div className="h-4 flex-1 bg-muted animate-pulse rounded" />
                <div className="h-4 w-20 bg-muted animate-pulse rounded" />
              </div>
            ))}
          </div>
        </div>
      ) : data ? (
        <Tabs defaultValue="resumen">
          <TabsList>
            <TabsTrigger value="resumen">Resumen</TabsTrigger>
            {puedeOperarCaja && <TabsTrigger value="movimientos">Movimientos Manuales</TabsTrigger>}
            {isAdmin && <TabsTrigger value="historial">Historial de Cierres</TabsTrigger>}
          </TabsList>

          <TabsContent value="resumen">
            <CajaResumen
              data={data}
              filtroMetodo={filtroMetodo}
              filtroTipo={filtroTipo}
              onFiltroMetodoChange={setFiltroMetodo}
              onFiltroTipoChange={setFiltroTipo}
            />
          </TabsContent>

          {puedeOperarCaja && (
            <TabsContent value="movimientos">
              <div className="space-y-4">
                <MovimientoManualForm
                  onCreated={() => {
                    setMovRefreshKey((k) => k + 1)
                    fetchData()
                  }}
                />
                <MovimientosManualesList fecha={fecha} refreshKey={movRefreshKey} />
              </div>
            </TabsContent>
          )}

          {isAdmin && (
            <TabsContent value="historial">
              <HistorialCierres />
            </TabsContent>
          )}
        </Tabs>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 px-4">
          <div className="flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-muted">
            <Loader2 className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Error al cargar datos</h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
            No pudimos obtener la información de caja. Verificá tu conexión e intentá de nuevo.
          </p>
          <Button variant="outline" onClick={fetchData}>
            Reintentar
          </Button>
        </div>
      )}

      {/* Dialogs */}
      <AperturaDialog
        open={aperturaOpen}
        onOpenChange={setAperturaOpen}
        onSuccess={handleSessionChange}
      />

      {sesionActual && (
        <CierreDialog
          open={cierreOpen}
          onOpenChange={setCierreOpen}
          sesionId={sesionActual.id}
          saldoInicial={sesionActual.saldoInicial}
          totalIngresosEfectivo={data?.totalIngresosEfectivo || 0}
          totalEgresosEfectivo={data?.totalEgresosEfectivo || 0}
          totalCostosFinancieros={data?.totalCostosFinancieros || 0}
          onSuccess={handleSessionChange}
        />
      )}
    </PageShell>
  )
}
