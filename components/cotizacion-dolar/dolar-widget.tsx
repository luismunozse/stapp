"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  ArrowRightLeft,
  DollarSign,
  Banknote
} from "lucide-react"
import { cn } from "@/lib/utils"

interface CotizacionDolar {
  moneda: string
  casa: string
  nombre: string
  compra: number
  venta: number
  fechaActualizacion: string
}

type TipoDolar = "blue" | "oficial" | "tarjeta"

const TIPOS_DOLAR: { key: TipoDolar; label: string; color: string }[] = [
  { key: "blue", label: "Blue", color: "text-blue-600 dark:text-blue-400" },
  { key: "oficial", label: "Oficial", color: "text-green-600 dark:text-green-400" },
  { key: "tarjeta", label: "Tarjeta", color: "text-purple-600 dark:text-purple-400" },
]

export function DolarWidget() {
  const [cotizaciones, setCotizaciones] = useState<Record<TipoDolar, CotizacionDolar | null>>({
    blue: null,
    oficial: null,
    tarjeta: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tipoSeleccionado, setTipoSeleccionado] = useState<TipoDolar>("blue")
  const [montoPesos, setMontoPesos] = useState<string>("")
  const [montoDolares, setMontoDolares] = useState<string>("")
  const [direccion, setDireccion] = useState<"pesosADolares" | "dolaresAPesos">("pesosADolares")

  const fetchCotizaciones = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("https://dolarapi.com/v1/dolares")
      if (!response.ok) throw new Error("Error al obtener cotizaciones")

      const data: CotizacionDolar[] = await response.json()

      const nuevasCotizaciones: Record<TipoDolar, CotizacionDolar | null> = {
        blue: data.find(d => d.casa === "blue") || null,
        oficial: data.find(d => d.casa === "oficial") || null,
        tarjeta: data.find(d => d.casa === "tarjeta") || null,
      }

      setCotizaciones(nuevasCotizaciones)
    } catch (err) {
      setError("No se pudieron cargar las cotizaciones")
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCotizaciones()
    // Actualizar cada 5 minutos
    const interval = setInterval(fetchCotizaciones, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const cotizacionActual = cotizaciones[tipoSeleccionado]

  const convertir = (valor: string, tipo: "pesosADolares" | "dolaresAPesos") => {
    if (!cotizacionActual || !valor) return ""
    const num = parseFloat(valor.replace(/,/g, "."))
    if (isNaN(num)) return ""

    if (tipo === "pesosADolares") {
      // Dividir por venta (compro dólares, me cobran precio de venta)
      return (num / cotizacionActual.venta).toFixed(2)
    } else {
      // Multiplicar por compra (vendo dólares, me pagan precio de compra)
      return (num * cotizacionActual.compra).toFixed(2)
    }
  }

  const handlePesosChange = (value: string) => {
    setMontoPesos(value)
    setDireccion("pesosADolares")
    setMontoDolares(convertir(value, "pesosADolares"))
  }

  const handleDolaresChange = (value: string) => {
    setMontoDolares(value)
    setDireccion("dolaresAPesos")
    setMontoPesos(convertir(value, "dolaresAPesos"))
  }

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num)
  }

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Cotización Dólar</CardTitle>
        <button
          onClick={fetchCotizaciones}
          disabled={loading}
          className="p-2 rounded-lg bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors"
        >
          <RefreshCw className={cn("h-4 w-4 text-primary", loading && "animate-spin")} />
        </button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : loading && !cotizacionActual ? (
          <div className="space-y-2">
            <div className="h-8 bg-muted animate-pulse rounded" />
            <div className="h-4 bg-muted animate-pulse rounded w-2/3" />
          </div>
        ) : (
          <>
            {/* Selector de tipo de dólar */}
            <div className="flex gap-1 p-1 bg-muted rounded-lg">
              {TIPOS_DOLAR.map(tipo => (
                <button
                  key={tipo.key}
                  onClick={() => setTipoSeleccionado(tipo.key)}
                  className={cn(
                    "flex-1 px-2 py-1 text-xs font-medium rounded transition-colors",
                    tipoSeleccionado === tipo.key
                      ? "bg-background shadow-sm"
                      : "hover:bg-background/50"
                  )}
                >
                  {tipo.label}
                </button>
              ))}
            </div>

            {/* Cotización actual */}
            {cotizacionActual && (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded bg-green-50 dark:bg-green-900/20">
                      <TrendingUp className="h-3 w-3 text-green-600" />
                    </div>
                    <span className="text-xs text-muted-foreground">Compra</span>
                  </div>
                  <span className="font-semibold text-green-600">
                    ${formatNumber(cotizacionActual.compra)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded bg-red-50 dark:bg-red-900/20">
                      <TrendingDown className="h-3 w-3 text-red-600" />
                    </div>
                    <span className="text-xs text-muted-foreground">Venta</span>
                  </div>
                  <span className="font-semibold text-red-600">
                    ${formatNumber(cotizacionActual.venta)}
                  </span>
                </div>
              </div>
            )}

            {/* Conversor */}
            <div className="pt-3 border-t space-y-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ArrowRightLeft className="h-3 w-3" />
                <span>Conversor</span>
              </div>

              <div className="grid grid-cols-[1fr,auto,1fr] gap-2 items-end">
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1">
                    <Banknote className="h-3 w-3" />
                    ARS
                  </Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={montoPesos}
                    onChange={(e) => handlePesosChange(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>

                <div className="pb-1">
                  <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1">
                    <DollarSign className="h-3 w-3" />
                    USD
                  </Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={montoDolares}
                    onChange={(e) => handleDolaresChange(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>

              {cotizacionActual && (
                <p className="text-xs text-muted-foreground text-center">
                  {direccion === "pesosADolares"
                    ? `Usando venta: $${formatNumber(cotizacionActual.venta)}`
                    : `Usando compra: $${formatNumber(cotizacionActual.compra)}`
                  }
                </p>
              )}
            </div>

            {/* Última actualización */}
            {cotizacionActual?.fechaActualizacion && (
              <p className="text-xs text-muted-foreground text-center pt-2">
                Actualizado: {new Date(cotizacionActual.fechaActualizacion).toLocaleString("es-AR")}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
