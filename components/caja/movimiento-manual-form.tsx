"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Plus, Paperclip, X, FileText } from "lucide-react"

const CONCEPTOS_INGRESO = [
  "Ingreso manual",
  "Cobro en efectivo",
  "Otro ingreso",
]

const CONCEPTOS_EGRESO = [
  "Retiro de efectivo",
  "Gasto varios",
  "Pago a proveedor",
  "Compra de insumos",
  "Otro egreso",
]

const METODOS = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "TARJETA_DEBITO", label: "Tarjeta Débito" },
  { value: "TARJETA_CREDITO", label: "Tarjeta Crédito" },
  { value: "MERCADOPAGO", label: "MercadoPago" },
  { value: "OTRO", label: "Otro" },
]

interface CategoriaGasto {
  id: string
  nombre: string
  tipo: "FIJO" | "VARIABLE"
  afectaRentabilidad: boolean
  color: string | null
  icono: string | null
  activo: boolean
}

interface MovimientoManualFormProps {
  onCreated: () => void
}

export function MovimientoManualForm({ onCreated }: MovimientoManualFormProps) {
  const [tipo, setTipo] = useState<"INGRESO" | "EGRESO">("EGRESO")
  const [monto, setMonto] = useState("")
  const [metodoPago, setMetodoPago] = useState("EFECTIVO")
  const [concepto, setConcepto] = useState("")
  const [conceptoCustom, setConceptoCustom] = useState("")
  const [observaciones, setObservaciones] = useState("")
  const [categoriaId, setCategoriaId] = useState<string>("")
  const [categorias, setCategorias] = useState<CategoriaGasto[]>([])
  const [comprobanteUrl, setComprobanteUrl] = useState<string>("")
  const [comprobanteFile, setComprobanteFile] = useState<File | null>(null)
  const [uploadingComprobante, setUploadingComprobante] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const conceptos = tipo === "INGRESO" ? CONCEPTOS_INGRESO : CONCEPTOS_EGRESO
  const conceptoFinal = concepto === "_custom" ? conceptoCustom : concepto

  // Cargar categorías al montar
  useEffect(() => {
    fetch("/api/categorias-gasto")
      .then((r) => (r.ok ? r.json() : { categorias: [] }))
      .then((d) => setCategorias(d.categorias || []))
      .catch(() => setCategorias([]))
  }, [])

  // Agrupar categorías por tipo para el select
  const categoriasFijas = categorias.filter((c) => c.tipo === "FIJO")
  const categoriasVariables = categorias.filter((c) => c.tipo === "VARIABLE")

  const categoriaSeleccionada = categorias.find((c) => c.id === categoriaId)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setComprobanteFile(file)
    setUploadingComprobante(true)
    setError("")
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/caja/movimientos/upload-comprobante", {
        method: "POST",
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al subir comprobante")
      setComprobanteUrl(data.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir comprobante")
      setComprobanteFile(null)
    } finally {
      setUploadingComprobante(false)
    }
  }

  const handleRemoveComprobante = () => {
    setComprobanteFile(null)
    setComprobanteUrl("")
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    const montoNum = parseFloat(monto)
    if (!monto || isNaN(montoNum) || montoNum <= 0) {
      setError("Ingrese un monto válido mayor a 0")
      return
    }
    if (!conceptoFinal) {
      setError("Seleccione o ingrese un concepto")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/caja/movimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          monto: montoNum,
          metodoPago,
          concepto: conceptoFinal,
          observaciones: observaciones || undefined,
          categoriaGastoId: tipo === "EGRESO" && categoriaId ? categoriaId : null,
          comprobanteUrl: comprobanteUrl || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error al crear movimiento")
      }

      // Reset form
      setMonto("")
      setConcepto("")
      setConceptoCustom("")
      setObservaciones("")
      setCategoriaId("")
      setComprobanteFile(null)
      setComprobanteUrl("")
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear movimiento")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Nuevo Movimiento Manual</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Tipo */}
            <div>
              <label className="text-sm font-medium">Tipo</label>
              <div className="flex gap-2 mt-1">
                <Button
                  type="button"
                  variant={tipo === "EGRESO" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => { setTipo("EGRESO"); setConcepto("") }}
                >
                  Egreso
                </Button>
                <Button
                  type="button"
                  variant={tipo === "INGRESO" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => { setTipo("INGRESO"); setConcepto(""); setCategoriaId("") }}
                >
                  Ingreso
                </Button>
              </div>
            </div>

            {/* Monto */}
            <div>
              <label className="text-sm font-medium">Monto</label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                className="mt-1"
              />
            </div>

            {/* Método de pago */}
            <div>
              <label className="text-sm font-medium">Método de pago</label>
              <Select value={metodoPago} onValueChange={setMetodoPago}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METODOS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Concepto */}
            <div>
              <label className="text-sm font-medium">Concepto</label>
              <Select value={concepto} onValueChange={setConcepto}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleccionar concepto" />
                </SelectTrigger>
                <SelectContent>
                  {conceptos.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                  <SelectItem value="_custom">Otro (personalizado)</SelectItem>
                </SelectContent>
              </Select>
              {concepto === "_custom" && (
                <Input
                  placeholder="Describir concepto..."
                  value={conceptoCustom}
                  onChange={(e) => setConceptoCustom(e.target.value)}
                  className="mt-2"
                />
              )}
            </div>
          </div>

          {/* Categoría de gasto - solo para EGRESO */}
          {tipo === "EGRESO" && (
            <div>
              <label className="text-sm font-medium">
                Categoría de gasto
                <span className="text-muted-foreground font-normal ml-1">(opcional, recomendado)</span>
              </label>
              <Select value={categoriaId || "_none"} onValueChange={(v) => setCategoriaId(v === "_none" ? "" : v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Sin categorizar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Sin categorizar</SelectItem>
                  {categoriasFijas.length > 0 && (
                    <>
                      <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">Gastos fijos</div>
                      {categoriasFijas.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex items-center gap-2">
                            {c.color && (
                              <span
                                className="inline-block w-2 h-2 rounded-full"
                                style={{ backgroundColor: c.color }}
                              />
                            )}
                            {c.nombre}
                            {!c.afectaRentabilidad && (
                              <span className="text-xs text-muted-foreground">(no afecta resultado)</span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </>
                  )}
                  {categoriasVariables.length > 0 && (
                    <>
                      <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">Gastos variables</div>
                      {categoriasVariables.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex items-center gap-2">
                            {c.color && (
                              <span
                                className="inline-block w-2 h-2 rounded-full"
                                style={{ backgroundColor: c.color }}
                              />
                            )}
                            {c.nombre}
                            {!c.afectaRentabilidad && (
                              <span className="text-xs text-muted-foreground">(no afecta resultado)</span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </>
                  )}
                </SelectContent>
              </Select>
              {categoriaSeleccionada && !categoriaSeleccionada.afectaRentabilidad && (
                <p className="text-xs text-muted-foreground mt-1">
                  Este movimiento sale de caja pero no se descuenta de la ganancia neta (ej: retiro del dueño).
                </p>
              )}
            </div>
          )}

          {/* Comprobante - solo para EGRESO */}
          {tipo === "EGRESO" && (
            <div>
              <label className="text-sm font-medium">
                Comprobante
                <span className="text-muted-foreground font-normal ml-1">(opcional, JPG/PNG/PDF, máx 5MB)</span>
              </label>
              {!comprobanteFile ? (
                <div className="mt-1">
                  <label className="flex items-center gap-2 px-3 py-2 border border-dashed rounded-md cursor-pointer hover:bg-muted/50 transition-colors w-fit">
                    <Paperclip className="h-4 w-4" />
                    <span className="text-sm">Adjuntar archivo</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-2 p-2 border rounded-md bg-muted/30">
                  {uploadingComprobante ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                  <span className="text-sm flex-1 truncate">{comprobanteFile.name}</span>
                  {comprobanteUrl && (
                    <a
                      href={comprobanteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      Ver
                    </a>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleRemoveComprobante}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Observaciones */}
          <div>
            <label className="text-sm font-medium">Observaciones (opcional)</label>
            <Textarea
              placeholder="Notas adicionales..."
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              className="mt-1"
              rows={2}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" disabled={loading} className="w-full sm:w-auto">
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Registrar Movimiento
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
