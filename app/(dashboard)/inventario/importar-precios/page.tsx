"use client"

import { useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { FileSpreadsheet, Upload, Loader2, Check, X, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageShell } from "@/components/ui/page-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"

type Cell = string | number | null

interface SheetPreview {
  name: string
  totalRows: number
  rows: Cell[][]
}

interface PreviewUpdate {
  id: string
  codigo: string
  nombre: string
  precioCompraActual: number | null
  precioVentaActual: number | null
  precioCompraNuevo: number | null
  precioVentaNuevo: number | null
  cambia: boolean
}

interface PreviewResponse {
  summary: {
    totalRows: number
    matched: number
    sinCambios: number
    unmatched: number
    errors: number
  }
  updates: PreviewUpdate[]
  unmatched: Array<{ rowIndex: number; codigo: string; nombre: string }>
  errors: Array<{ rowIndex: number; codigo: string; message: string }>
}

const NONE_VALUE = "__none__"

type Step = "upload" | "sheet" | "mapping" | "preview"

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(",")[1] || ""
      resolve(base64)
    }
    reader.onerror = () =>
      reject(new Error("No se pudo leer el archivo. Verificá que no esté abierto en Excel."))
    reader.readAsDataURL(file)
  })
}

function fmtPrice(v: number | null): string {
  if (v === null || v === undefined) return "—"
  return v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function deltaPct(actual: number | null, nuevo: number | null): string {
  if (actual === null || nuevo === null || actual === 0) return ""
  const pct = ((nuevo - actual) / actual) * 100
  const sign = pct > 0 ? "+" : ""
  return `${sign}${pct.toFixed(1)}%`
}

export default function ImportarPreciosPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>("upload")
  const [fileName, setFileName] = useState<string>("")
  const [fileBase64, setFileBase64] = useState<string>("")
  const [sheets, setSheets] = useState<SheetPreview[]>([])
  const [selectedSheet, setSelectedSheet] = useState<string>("")
  const [headerRow, setHeaderRow] = useState<number>(0)
  const [mapping, setMapping] = useState<{
    codigo?: number
    nombre?: number
    precioCompra?: number
    precioVenta?: number
  }>({})
  const [onlyIncrease, setOnlyIncrease] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  const sheetData = useMemo(
    () => sheets.find((s) => s.name === selectedSheet),
    [sheets, selectedSheet]
  )

  const headers = useMemo(() => {
    if (!sheetData) return []
    return sheetData.rows[headerRow] || []
  }, [sheetData, headerRow])

  const reset = () => {
    setFileName("")
    setFileBase64("")
    setSheets([])
    setSelectedSheet("")
    setHeaderRow(0)
    setMapping({})
    setOnlyIncrease(false)
    setMotivo("")
    setPreview(null)
    setExcludedIds(new Set())
    setStep("upload")
  }

  const handleFile = async (file: File) => {
    setLoading(true)
    try {
      const base64 = await fileToBase64(file)
      const res = await fetch("/api/inventario/precios/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: base64, mime: file.type }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "No se pudo leer el archivo")
        return
      }
      setFileName(file.name)
      setFileBase64(base64)
      setSheets(data.sheets)
      setSelectedSheet(data.sheets[0]?.name || "")
      setHeaderRow(0)
      setStep("sheet")
    } catch (e) {
      console.error(e)
      toast.error(e instanceof Error ? e.message : "Error al leer el archivo")
    } finally {
      setLoading(false)
    }
  }

  const goToMapping = () => {
    if (!selectedSheet) {
      toast.error("Elegí una hoja")
      return
    }
    if (!sheetData || sheetData.rows.length <= headerRow + 1) {
      toast.error("La hoja no tiene filas de datos debajo del encabezado")
      return
    }
    // auto-detect columns by header keywords
    const hs = (sheetData.rows[headerRow] || []).map((c) =>
      String(c ?? "").toLowerCase().trim()
    )
    const detect = (regexes: RegExp[]): number | undefined => {
      for (let i = 0; i < hs.length; i++) {
        for (const r of regexes) {
          if (r.test(hs[i])) return i
        }
      }
      return undefined
    }
    setMapping({
      codigo: detect([/^c[oó]digo$/i, /^codigo$/i, /^cod\.?$/i, /^sku$/i]),
      nombre: detect([/^nombre$/i, /descrip/i, /producto/i, /art[ií]culo/i]),
      precioCompra: detect([/costo/i, /compra/i, /precio.?compra/i]),
      precioVenta: detect([/venta/i, /^precio$/i, /^pvp$/i, /lista/i]),
    })
    setStep("mapping")
  }

  const runPreview = async () => {
    if (mapping.codigo == null) {
      toast.error("Tenés que mapear la columna de código")
      return
    }
    if (mapping.precioCompra == null && mapping.precioVenta == null) {
      toast.error("Mapeá al menos una columna de precio")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/inventario/precios/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: fileBase64,
          sheet: selectedSheet,
          headerRow,
          mapping,
          options: { onlyIncreasePrices: onlyIncrease },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Error en la vista previa")
        return
      }
      setPreview(data)
      setExcludedIds(new Set())
      setStep("preview")
    } catch (e) {
      console.error(e)
      toast.error("Error al generar la vista previa")
    } finally {
      setLoading(false)
    }
  }

  const toggleRow = (id: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const applyChanges = async () => {
    if (!preview) return
    const updates = preview.updates
      .filter((u) => u.cambia && !excludedIds.has(u.id))
      .map((u) => ({
        id: u.id,
        precioCompraNuevo: u.precioCompraNuevo,
        precioVentaNuevo: u.precioVentaNuevo,
      }))
    if (updates.length === 0) {
      toast.error("No hay cambios seleccionados")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/inventario/precios/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates, motivo: motivo.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Error al aplicar cambios")
        return
      }
      toast.success(`${data.updated} precio${data.updated === 1 ? "" : "s"} actualizado${data.updated === 1 ? "" : "s"}`)
      router.push("/inventario")
    } catch (e) {
      console.error(e)
      toast.error("Error al aplicar cambios")
    } finally {
      setLoading(false)
    }
  }

  const columnOptions = useMemo(() => {
    return headers.map((h, idx) => ({
      value: String(idx),
      label: `${idx + 1}. ${String(h ?? "").trim() || "(vacía)"}`,
    }))
  }, [headers])

  const cambiosCount = preview
    ? preview.updates.filter((u) => u.cambia && !excludedIds.has(u.id)).length
    : 0

  return (
    <PageShell
      title="Importar lista de precios"
      description="Subí un archivo Excel del proveedor para actualizar precios masivamente"
      icon={FileSpreadsheet}
      backHref="/inventario"
    >
      <div className="flex gap-2 text-xs">
        {(["upload", "sheet", "mapping", "preview"] as Step[]).map((s, idx) => {
          const active = s === step
          const done =
            (["upload", "sheet", "mapping", "preview"] as Step[]).indexOf(step) > idx
          const label = ["1. Archivo", "2. Hoja", "3. Columnas", "4. Revisar"][idx]
          return (
            <div
              key={s}
              className={`px-3 py-1.5 rounded-full border ${
                active
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : done
                    ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400"
                    : "border-muted text-muted-foreground"
              }`}
            >
              {label}
            </div>
          )
        })}
      </div>

      {step === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle>Subir archivo Excel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="border-2 border-dashed border-muted rounded-lg p-8 text-center cursor-pointer hover:border-primary transition"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              <p className="font-medium">Hacé click o arrastrá un archivo</p>
              <p className="text-sm text-muted-foreground mt-1">
                Formato .xlsx — máximo 6MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  // Limpiar el value: sin esto, re-elegir el MISMO archivo no
                  // dispara change y el reintento queda en silencio.
                  e.target.value = ""
                  if (f) handleFile(f)
                }}
              />
            </div>
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Procesando archivo...
              </div>
            )}
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <p className="font-medium mb-1">Cómo funciona</p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>Solo se actualizan productos existentes (match por <strong>código interno</strong>)</li>
                <li>Productos no encontrados se listan, no se crean</li>
                <li>Los cambios se registran en el historial de precios</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "sheet" && sheetData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Hoja y fila de encabezados</span>
              <span className="text-sm font-normal text-muted-foreground">{fileName}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Hoja</Label>
                <Select value={selectedSheet} onValueChange={(v) => { setSelectedSheet(v); setHeaderRow(0) }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sheets.map((s) => (
                      <SelectItem key={s.name} value={s.name}>
                        {s.name} ({s.totalRows} filas)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Fila de encabezados</Label>
                <p className="text-xs text-muted-foreground mb-1">
                  Hacé click en la fila que contiene los nombres de columnas
                </p>
              </div>
            </div>

            <div className="border rounded-md overflow-auto max-h-96">
              <table className="text-xs w-full">
                <tbody>
                  {sheetData.rows.map((row, idx) => {
                    const isHeader = idx === headerRow
                    return (
                      <tr
                        key={idx}
                        onClick={() => setHeaderRow(idx)}
                        className={`cursor-pointer border-b ${
                          isHeader
                            ? "bg-primary/15 font-semibold"
                            : "hover:bg-muted/50"
                        }`}
                      >
                        <td className="px-2 py-1 text-muted-foreground tabular-nums w-10">
                          {idx + 1}
                        </td>
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-2 py-1 whitespace-nowrap max-w-[200px] truncate">
                            {cell === null || cell === undefined ? "" : String(cell)}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={reset}>
                Cambiar archivo
              </Button>
              <Button onClick={goToMapping}>Continuar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "mapping" && sheetData && (
        <Card>
          <CardHeader>
            <CardTitle>Mapear columnas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Indicá qué columna del Excel corresponde a cada campo. <strong>Código</strong> es obligatorio. Mapeá al menos un precio.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Código <span className="text-red-500">*</span></Label>
                <Select
                  value={mapping.codigo != null ? String(mapping.codigo) : NONE_VALUE}
                  onValueChange={(v) =>
                    setMapping((m) => ({ ...m, codigo: v === NONE_VALUE ? undefined : Number(v) }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Elegí columna..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>— sin mapear —</SelectItem>
                    {columnOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Nombre (informativo)</Label>
                <Select
                  value={mapping.nombre != null ? String(mapping.nombre) : NONE_VALUE}
                  onValueChange={(v) =>
                    setMapping((m) => ({ ...m, nombre: v === NONE_VALUE ? undefined : Number(v) }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Elegí columna..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>— sin mapear —</SelectItem>
                    {columnOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Precio compra / costo</Label>
                <Select
                  value={mapping.precioCompra != null ? String(mapping.precioCompra) : NONE_VALUE}
                  onValueChange={(v) =>
                    setMapping((m) => ({
                      ...m,
                      precioCompra: v === NONE_VALUE ? undefined : Number(v),
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Elegí columna..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>— sin mapear —</SelectItem>
                    {columnOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Precio venta</Label>
                <Select
                  value={mapping.precioVenta != null ? String(mapping.precioVenta) : NONE_VALUE}
                  onValueChange={(v) =>
                    setMapping((m) => ({
                      ...m,
                      precioVenta: v === NONE_VALUE ? undefined : Number(v),
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Elegí columna..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>— sin mapear —</SelectItem>
                    {columnOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Switch checked={onlyIncrease} onCheckedChange={setOnlyIncrease} id="only-increase" />
              <Label htmlFor="only-increase" className="cursor-pointer">
                Solo aumentar precios (ignorar bajas)
              </Label>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep("sheet")}>
                Atrás
              </Button>
              <Button onClick={runPreview} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Ver cambios
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "preview" && preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Filas leídas</p>
                <p className="text-2xl font-bold">{preview.summary.totalRows}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Cambios</p>
                <p className="text-2xl font-bold text-green-600">{preview.summary.matched}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">No encontrados</p>
                <p className="text-2xl font-bold text-orange-500">{preview.summary.unmatched}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Errores</p>
                <p className="text-2xl font-bold text-red-500">{preview.summary.errors}</p>
              </CardContent>
            </Card>
          </div>

          {preview.updates.filter((u) => u.cambia).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cambios a aplicar</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left w-8"></th>
                        <th className="px-3 py-2 text-left">Código</th>
                        <th className="px-3 py-2 text-left">Producto</th>
                        <th className="px-3 py-2 text-right">Costo actual</th>
                        <th className="px-3 py-2 text-right">Costo nuevo</th>
                        <th className="px-3 py-2 text-right">Venta actual</th>
                        <th className="px-3 py-2 text-right">Venta nueva</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.updates
                        .filter((u) => u.cambia)
                        .map((u) => {
                          const excluded = excludedIds.has(u.id)
                          return (
                            <tr
                              key={u.id}
                              className={`border-t ${excluded ? "opacity-40" : ""}`}
                            >
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={!excluded}
                                  onChange={() => toggleRow(u.id)}
                                />
                              </td>
                              <td className="px-3 py-2 font-mono text-xs">{u.codigo}</td>
                              <td className="px-3 py-2">{u.nombre}</td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {fmtPrice(u.precioCompraActual)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {u.precioCompraNuevo != null ? (
                                  <span>
                                    {fmtPrice(u.precioCompraNuevo)}
                                    <span className="ml-1 text-xs text-muted-foreground">
                                      {deltaPct(u.precioCompraActual, u.precioCompraNuevo)}
                                    </span>
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {fmtPrice(u.precioVentaActual)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {u.precioVentaNuevo != null ? (
                                  <span>
                                    {fmtPrice(u.precioVentaNuevo)}
                                    <span className="ml-1 text-xs text-muted-foreground">
                                      {deltaPct(u.precioVentaActual, u.precioVentaNuevo)}
                                    </span>
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {preview.unmatched.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  No encontrados ({preview.unmatched.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-2">
                  Estos códigos no existen en el inventario y se ignorarán:
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
                  {preview.unmatched.slice(0, 100).map((u, i) => (
                    <Badge key={i} variant="secondary" className="font-mono text-xs">
                      {u.codigo}
                    </Badge>
                  ))}
                  {preview.unmatched.length > 100 && (
                    <span className="text-xs text-muted-foreground self-center">
                      y {preview.unmatched.length - 100} más...
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {preview.errors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-red-500">
                  <X className="h-4 w-4" />
                  Errores ({preview.errors.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-1 max-h-40 overflow-auto">
                  {preview.errors.slice(0, 50).map((e, i) => (
                    <li key={i}>
                      <span className="font-mono text-xs">Fila {e.rowIndex + headerRow + 2}</span>
                      {e.codigo ? <span className="ml-1 font-mono text-xs">[{e.codigo}]</span> : null}
                      <span className="ml-2 text-red-600 dark:text-red-400">{e.message}</span>
                    </li>
                  ))}
                  {preview.errors.length > 50 && (
                    <li className="text-xs text-muted-foreground">
                      y {preview.errors.length - 50} más...
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4 space-y-3">
              <div>
                <Label htmlFor="motivo">Motivo (opcional)</Label>
                <Input
                  id="motivo"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej: Lista de precios proveedor X — abril 2026"
                  maxLength={200}
                />
              </div>
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep("mapping")}>
                  Atrás
                </Button>
                <Button onClick={applyChanges} disabled={loading || cambiosCount === 0}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                  Aplicar {cambiosCount} cambio{cambiosCount === 1 ? "" : "s"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  )
}
