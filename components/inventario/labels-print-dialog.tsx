"use client"

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import Link from "next/link"
import useSWR from "swr"
import JsBarcode from "jsbarcode"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Printer, AlertTriangle, Download, Usb, Settings2 } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import {
  generateZpl,
  generateEpl,
  renderTemplate,
  type LabelItem as ZplLabelItem,
  type LabelTemplate as ZplLabelTemplate,
} from "@/lib/labels/zpl"
import { downloadLabelFile, tryDirectPrintZebra } from "@/lib/labels/print"

type OutputFormat = "PDF" | "ZPL" | "EPL"

interface ApiLabelTemplate {
  id: string
  nombre: string
  formato: "PDF" | "ZPL" | "EPL"
  ancho_mm: number
  alto_mm: number
  dpi: 152 | 203 | 300
  template: string
  es_default: boolean
}

const swrFetcher = (url: string) => fetch(url).then((r) => r.json())

interface LabelItem {
  id: string
  nombre: string
  codigo: string
  barcode?: string | null
  precioVenta: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: LabelItem[]
}

type LabelSize = "50x30" | "40x25" | "38x25" | "60x40"
type BarcodeFormat = "AUTO" | "CODE128" | "EAN13" | "EAN8" | "UPC"

const LABEL_SIZES: Record<LabelSize, { label: string; widthMm: number; heightMm: number }> = {
  "40x25": { label: "40 × 25 mm", widthMm: 40, heightMm: 25 },
  "38x25": { label: "38 × 25 mm", widthMm: 38, heightMm: 25 },
  "50x30": { label: "50 × 30 mm", widthMm: 50, heightMm: 30 },
  "60x40": { label: "60 × 40 mm", widthMm: 60, heightMm: 40 },
}

const FORMAT_LABELS: Record<BarcodeFormat, string> = {
  AUTO: "Auto-detectar",
  CODE128: "CODE128 (alfanumérico)",
  EAN13: "EAN-13 (13 dígitos)",
  EAN8: "EAN-8 (8 dígitos)",
  UPC: "UPC-A (12 dígitos)",
}

function detectFormat(code: string): "CODE128" | "EAN13" | "EAN8" | "UPC" {
  if (/^\d{13}$/.test(code)) return "EAN13"
  if (/^\d{12}$/.test(code)) return "UPC"
  if (/^\d{8}$/.test(code)) return "EAN8"
  return "CODE128"
}

function checkCompatibility(code: string, format: BarcodeFormat): { ok: boolean; reason?: string } {
  const trimmed = code.trim()
  if (!trimmed) return { ok: false, reason: "Sin código" }
  if (format === "AUTO" || format === "CODE128") return { ok: true }
  const onlyDigits = trimmed.replace(/\D/g, "")
  const lengthRules: Record<string, number> = { EAN13: 13, EAN8: 8, UPC: 12 }
  const expected = lengthRules[format]
  if (onlyDigits.length !== expected) {
    return { ok: false, reason: `Necesita ${expected} dígitos (tiene ${onlyDigits.length || trimmed.length})` }
  }
  if (onlyDigits !== trimmed) {
    return { ok: false, reason: "Contiene caracteres no numéricos" }
  }
  return { ok: true }
}

interface BarcodeResult {
  svg: string
  error?: string
  resolvedFormat?: string
}

function generateBarcodeSVG(
  rawValue: string,
  widthMm: number,
  heightMm: number,
  format: BarcodeFormat,
): BarcodeResult {
  if (typeof document === "undefined") return { svg: "", error: "SSR sin document" }

  // Sanitización: EAN/UPC solo dígitos. Removemos espacios/guiones que vienen
  // de copy-paste (ej "779 0001 000017" → "7790001000017").
  let value = rawValue.trim()
  const resolved = format === "AUTO" ? detectFormat(value) : format
  if (resolved === "EAN13" || resolved === "EAN8" || resolved === "UPC") {
    value = value.replace(/\D/g, "")
  }

  if (!value) return { svg: "", error: "Código vacío", resolvedFormat: resolved }

  // Validación previa: JsBarcode tira excepción genérica sin detalle.
  const lengthRules: Record<string, number> = { EAN13: 13, EAN8: 8, UPC: 12 }
  const expectedLen = lengthRules[resolved]
  if (expectedLen && value.length !== expectedLen) {
    return {
      svg: "",
      error: `${resolved} requiere ${expectedLen} dígitos, recibió ${value.length} ("${value}")`,
      resolvedFormat: resolved,
    }
  }

  try {
    const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    let jsbErr: string | undefined
    JsBarcode(svgNode, value, {
      format: resolved,
      displayValue: false,
      margin: 0,
      height: Math.max(30, heightMm * 2),
      width: Math.max(1, Math.round(widthMm / 40)),
      valid: (isValid: boolean) => {
        if (!isValid) jsbErr = `JsBarcode rechazó ${resolved}: "${value}" (checksum o formato inválido)`
      },
    })
    if (jsbErr) return { svg: "", error: jsbErr, resolvedFormat: resolved }
    if (!svgNode.hasChildNodes()) {
      return { svg: "", error: `JsBarcode no generó nodos para ${resolved}: "${value}"`, resolvedFormat: resolved }
    }
    return { svg: svgNode.outerHTML, resolvedFormat: resolved }
  } catch (e) {
    return {
      svg: "",
      error: `Excepción JsBarcode (${resolved}): ${e instanceof Error ? e.message : String(e)}`,
      resolvedFormat: resolved,
    }
  }
}

export function LabelsPrintDialog({ open, onOpenChange, items }: Props) {
  const { formatPrice } = useCurrency()
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("PDF")
  const [size, setSize] = useState<LabelSize>("50x30")
  const [format, setFormat] = useState<BarcodeFormat>("AUTO")
  const [showName, setShowName] = useState(true)
  const [showPrice, setShowPrice] = useState(true)
  const [showCode, setShowCode] = useState(true)
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((i) => [i.id, 1]))
  )
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("")
  const [thermalError, setThermalError] = useState<string>("")
  const [thermalOk, setThermalOk] = useState<string>("")
  const [hasWebUsb, setHasWebUsb] = useState(false)
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    setHasWebUsb(typeof navigator !== "undefined" && !!(navigator as any).usb)
  }, [])

  const sizeConfig = LABEL_SIZES[size]

  // Cero cantidad para items incompatibles con formato actual.
  // Evita que click "Imprimir" tire alert por items que el usuario no ve descartados.
  // Sólo aplica en modo PDF (ZPL/EPL aceptan cualquier string).
  useEffect(() => {
    if (outputFormat !== "PDF") return
    setQuantities((prev) => {
      let changed = false
      const next = { ...prev }
      for (const item of items) {
        const code = item.barcode || item.codigo || ""
        const compat = checkCompatibility(code, format)
        if (!compat.ok && (next[item.id] ?? 0) > 0) {
          next[item.id] = 0
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [format, items, outputFormat])

  const totalLabels = useMemo(
    () => items.reduce((sum, i) => sum + (quantities[i.id] || 0), 0),
    [items, quantities]
  )

  const updateQty = (id: string, value: string) => {
    const n = parseInt(value, 10)
    setQuantities((prev) => ({ ...prev, [id]: isNaN(n) || n < 0 ? 0 : Math.min(n, 999) }))
  }

  const handlePrint = useCallback(() => {
    const labelsHTML: string[] = []
    const skipped: string[] = []
    for (const item of items) {
      const qty = quantities[item.id] || 0
      if (qty <= 0) continue
      const code = (item.barcode || item.codigo || "").trim()
      if (!code) continue
      const result = generateBarcodeSVG(code, sizeConfig.widthMm, sizeConfig.heightMm, format)
      if (!result.svg) {
        const reason = result.error || "motivo desconocido"
        console.error(`[labels-print] item="${item.nombre}" code="${code}" → ${reason}`)
        skipped.push(`${item.nombre} (${code}): ${reason}`)
        continue
      }

      const labelHTML = `
        <div class="label">
          ${showName ? `<div class="name">${escapeHtml(item.nombre)}</div>` : ""}
          <div class="barcode">${result.svg}</div>
          ${showCode ? `<div class="code">${escapeHtml(code)}</div>` : ""}
          ${showPrice ? `<div class="price">${formatPrice(item.precioVenta)}</div>` : ""}
        </div>
      `
      for (let i = 0; i < qty; i++) {
        labelsHTML.push(labelHTML)
      }
    }

    if (skipped.length > 0) {
      alert(
        `No se pudieron generar ${skipped.length} etiqueta(s):\n\n${skipped.join("\n\n")}\n\nVer consola del navegador para detalle. Verificá que el código coincida con el formato seleccionado.`,
      )
    }

    if (labelsHTML.length === 0) return

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Etiquetas</title>
<style>
  @page { size: auto; margin: 5mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; }
  .sheet {
    display: flex; flex-wrap: wrap;
    gap: 2mm;
  }
  .label {
    width: ${sizeConfig.widthMm}mm;
    height: ${sizeConfig.heightMm}mm;
    padding: 1mm 1.5mm;
    border: 1px dashed #ccc;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    overflow: hidden;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  @media print { .label { border: none; } }
  .name {
    font-size: ${sizeConfig.widthMm >= 50 ? 9 : 7}pt;
    font-weight: 600;
    text-align: center;
    width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.1;
  }
  .barcode { width: 100%; flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .barcode svg { width: 100%; height: 100%; max-height: 100%; }
  .code {
    font-size: ${sizeConfig.widthMm >= 50 ? 7 : 6}pt;
    font-family: 'Courier New', monospace;
    letter-spacing: 0.5px;
    line-height: 1;
  }
  .price {
    font-size: ${sizeConfig.widthMm >= 50 ? 11 : 9}pt;
    font-weight: 700;
    line-height: 1.1;
    margin-top: 1px;
  }
</style></head><body>
  <div class="sheet">${labelsHTML.join("")}</div>
  <script>window.onload=function(){setTimeout(function(){window.print();},100);}<\/script>
</body></html>`

    const w = window.open("", "_blank", "width=900,height=700")
    if (!w) return
    w.document.write(html)
    w.document.close()
  }, [items, quantities, sizeConfig, format, showName, showCode, showPrice, formatPrice])

  // ============================================================
  // Térmico (ZPL/EPL): templates desde DB + generación raw + preview
  // ============================================================
  const thermalKey =
    outputFormat === "ZPL" || outputFormat === "EPL"
      ? `/api/label-templates?formato=${outputFormat}`
      : null
  const { data: templatesData } = useSWR<ApiLabelTemplate[]>(thermalKey, swrFetcher)
  const templates = useMemo<ApiLabelTemplate[]>(
    () => (Array.isArray(templatesData) ? templatesData : []),
    [templatesData],
  )

  // Auto-seleccionar el default cuando llegan templates o cambia de formato.
  useEffect(() => {
    if (outputFormat === "PDF") return
    if (templates.length === 0) {
      setSelectedTemplateId("")
      return
    }
    const stillExists = templates.some((t) => t.id === selectedTemplateId)
    if (!stillExists) {
      const def = templates.find((t) => t.es_default) || templates[0]
      setSelectedTemplateId(def.id)
    }
  }, [templates, outputFormat, selectedTemplateId])

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId],
  )

  // Lista expandida de items (1 entrada por etiqueta) respetando cantidades.
  const expandedItems = useMemo<ZplLabelItem[]>(() => {
    const out: ZplLabelItem[] = []
    for (const item of items) {
      const qty = quantities[item.id] || 0
      if (qty <= 0) continue
      const li: ZplLabelItem = {
        codigo: item.codigo || "",
        nombre: item.nombre || "",
        barcode: item.barcode || item.codigo || null,
        precioVenta: item.precioVenta,
      }
      for (let i = 0; i < qty; i++) out.push(li)
    }
    return out
  }, [items, quantities])

  // Generación raw del spool (ZPL o EPL) para descarga e impresión directa.
  const rawSpool = useMemo(() => {
    if (!selectedTemplate || expandedItems.length === 0) return ""
    const tpl: ZplLabelTemplate = {
      id: selectedTemplate.id,
      formato: selectedTemplate.formato === "EPL" ? "EPL" : "ZPL",
      ancho_mm: Number(selectedTemplate.ancho_mm),
      alto_mm: Number(selectedTemplate.alto_mm),
      dpi: selectedTemplate.dpi,
      template: selectedTemplate.template,
    }
    // org_nombre queda vacío — los templates default no lo usan. Para usarlo
    // el usuario lo agregaría en el editor del template.
    return tpl.formato === "EPL"
      ? generateEpl(expandedItems, tpl, "")
      : generateZpl(expandedItems, tpl, "")
  }, [selectedTemplate, expandedItems])

  // Preview = primer item renderizado (no concatenado), para que el textarea
  // no muestre 200 etiquetas idénticas.
  const previewSpool = useMemo(() => {
    if (!selectedTemplate) return ""
    const first = expandedItems[0] || items[0]
    if (!first) return selectedTemplate.template
    const tpl: ZplLabelTemplate = {
      id: selectedTemplate.id,
      formato: selectedTemplate.formato === "EPL" ? "EPL" : "ZPL",
      ancho_mm: Number(selectedTemplate.ancho_mm),
      alto_mm: Number(selectedTemplate.alto_mm),
      dpi: selectedTemplate.dpi,
      template: selectedTemplate.template,
    }
    const li: ZplLabelItem = {
      codigo: (first as any).codigo || "",
      nombre: (first as any).nombre || "",
      barcode: (first as any).barcode || (first as any).codigo || null,
      precioVenta: (first as any).precioVenta || 0,
    }
    return tpl.formato === "EPL"
      ? generateEpl([li], tpl, "")
      : generateZpl([li], tpl, "")
  }, [selectedTemplate, expandedItems, items])

  // Render best-effort en canvas — sólo aproxima la disposición. Parsea ^FOx,y
  // / ^FDtexto del ZPL y dibuja a escala. Para EPL parsea coords iniciales.
  useEffect(() => {
    const canvas = previewCanvasRef.current
    if (!canvas || !selectedTemplate || (outputFormat !== "ZPL" && outputFormat !== "EPL")) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpi = selectedTemplate.dpi || 203
    const dotsPerMm = dpi / 25.4
    const widthDots = Number(selectedTemplate.ancho_mm) * dotsPerMm
    const heightDots = Number(selectedTemplate.alto_mm) * dotsPerMm
    const scale = Math.min(360 / widthDots, 160 / heightDots)
    canvas.width = Math.max(1, Math.round(widthDots * scale))
    canvas.height = Math.max(1, Math.round(heightDots * scale))
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = "#111111"

    const first = expandedItems[0] || items[0]
    const vars: Record<string, string> = first
      ? {
          codigo: (first as any).codigo || "",
          nombre: (first as any).nombre || "",
          barcode: (first as any).barcode || (first as any).codigo || "",
          precio:
            typeof (first as any).precioVenta === "number"
              ? (first as any).precioVenta.toFixed(2)
              : "",
          org_nombre: "",
        }
      : {}

    if (selectedTemplate.formato === "ZPL") {
      // Parser mínimo ZPL: ^FOx,y ... ^FDtext^FS y ^BCN para detectar barcode.
      const tpl = renderTemplate(selectedTemplate.template, vars)
      const fieldRe = /\^FO(\d+),(\d+)([\s\S]*?)\^FD([\s\S]*?)\^FS/g
      let m: RegExpExecArray | null
      while ((m = fieldRe.exec(tpl))) {
        const x = parseInt(m[1], 10) * scale
        const y = parseInt(m[2], 10) * scale
        const meta = m[3] || ""
        // \5E es la representación escapada de ^ dentro de ^FD — restaurar.
        const txt = (m[4] || "").replace(/\\5E/g, "^").replace(/\\\\/g, "\\")
        const isBarcode = /\^BC|\^BY/.test(meta)
        if (isBarcode) {
          ctx.fillStyle = "#222"
          for (let i = 0; i < Math.min(60, txt.length * 6); i++) {
            if (i % 2 === 0) ctx.fillRect(x + i * 2 * scale, y, 1 * scale, 18 * scale)
          }
          ctx.fillStyle = "#111"
        } else {
          const sizeMatch = meta.match(/\^A0N,(\d+)/)
          const fs = sizeMatch ? Math.max(8, parseInt(sizeMatch[1], 10) * scale) : 10
          ctx.font = `${fs}px sans-serif`
          ctx.textBaseline = "top"
          ctx.fillText(txt, x, y, canvas.width - x)
        }
      }
    } else {
      // EPL: A<x>,<y>,... "texto" (texto) o B<x>,<y>,... "barcode"
      const tpl = renderTemplate(selectedTemplate.template, vars)
      const lineRe = /^([AB])(\d+),(\d+)[^"]*"([^"]*)"/gm
      let m: RegExpExecArray | null
      while ((m = lineRe.exec(tpl))) {
        const cmd = m[1]
        const x = parseInt(m[2], 10) * scale
        const y = parseInt(m[3], 10) * scale
        const txt = (m[4] || "").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
        if (cmd === "B") {
          ctx.fillStyle = "#222"
          for (let i = 0; i < Math.min(60, txt.length * 6); i++) {
            if (i % 2 === 0) ctx.fillRect(x + i * 2 * scale, y, 1 * scale, 18 * scale)
          }
          ctx.fillStyle = "#111"
        } else {
          ctx.font = `${Math.max(8, 12 * scale)}px sans-serif`
          ctx.textBaseline = "top"
          ctx.fillText(txt, x, y, canvas.width - x)
        }
      }
    }
    ctx.strokeStyle = "#ddd"
    ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1)
  }, [selectedTemplate, expandedItems, items, outputFormat])

  const handleDownloadThermal = useCallback(() => {
    if (!selectedTemplate || !rawSpool) return
    const ext = selectedTemplate.formato === "EPL" ? "epl" : "zpl"
    const ts = new Date().toISOString().slice(0, 10)
    downloadLabelFile(rawSpool, `etiquetas-${ts}.${ext}`, "application/octet-stream")
  }, [selectedTemplate, rawSpool])

  const handleDirectPrint = useCallback(async () => {
    setThermalError("")
    setThermalOk("")
    if (!rawSpool) {
      setThermalError("Sin etiquetas para imprimir")
      return
    }
    const res = await tryDirectPrintZebra(rawSpool)
    if (res.ok) {
      setThermalOk("Etiquetas enviadas a la impresora")
    } else {
      setThermalError(res.error || "No se pudo imprimir")
    }
  }, [rawSpool])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-4 w-4" />
            Imprimir etiquetas con código de barras
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          <Tabs value={outputFormat} onValueChange={(v) => setOutputFormat(v as OutputFormat)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="PDF">PDF / Hoja</TabsTrigger>
              <TabsTrigger value="ZPL">ZPL (Zebra)</TabsTrigger>
              <TabsTrigger value="EPL">EPL (Zebra antigua)</TabsTrigger>
            </TabsList>

            <TabsContent value="PDF" className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Tamaño de etiqueta</Label>
                  <Select value={size} onValueChange={(v) => setSize(v as LabelSize)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(LABEL_SIZES).map(([key, cfg]) => (
                        <SelectItem key={key} value={key}>
                          {cfg.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Formato de código</Label>
                  <Select value={format} onValueChange={(v) => setFormat(v as BarcodeFormat)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(FORMAT_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Mostrar en la etiqueta</Label>
                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Switch checked={showName} onCheckedChange={setShowName} />
                      Nombre
                    </label>
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Switch checked={showCode} onCheckedChange={setShowCode} />
                      Código
                    </label>
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Switch checked={showPrice} onCheckedChange={setShowPrice} />
                      Precio
                    </label>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="ZPL" className="space-y-3">
              <ThermalConfig
                formato="ZPL"
                templates={templates}
                selectedId={selectedTemplateId}
                onSelect={setSelectedTemplateId}
                previewSpool={previewSpool}
                canvasRef={previewCanvasRef}
                error={thermalError}
                okMsg={thermalOk}
                selectedTemplate={selectedTemplate}
              />
            </TabsContent>

            <TabsContent value="EPL" className="space-y-3">
              <ThermalConfig
                formato="EPL"
                templates={templates}
                selectedId={selectedTemplateId}
                onSelect={setSelectedTemplateId}
                previewSpool={previewSpool}
                canvasRef={previewCanvasRef}
                error={thermalError}
                okMsg={thermalOk}
                selectedTemplate={selectedTemplate}
              />
            </TabsContent>
          </Tabs>

          <div className="border rounded-md">
            <div className="grid grid-cols-[1fr_90px] gap-2 px-3 py-2 text-xs font-medium text-muted-foreground border-b bg-muted/40">
              <span>Producto</span>
              <span className="text-center">Cantidad</span>
            </div>
            <div className="divide-y max-h-[280px] overflow-y-auto">
              {items.map((item) => {
                const code = item.barcode || item.codigo || ""
                const hasCode = !!code
                // ZPL/EPL aceptan cualquier string en el barcode (los renders default
                // usan Code128). Sólo validamos formato estricto en modo PDF.
                const compat =
                  outputFormat !== "PDF"
                    ? { ok: hasCode, reason: hasCode ? undefined : "Sin código" }
                    : hasCode
                      ? checkCompatibility(code, format)
                      : { ok: false, reason: "Sin código" }
                return (
                  <div
                    key={item.id}
                    className="grid grid-cols-[1fr_90px] gap-2 items-center px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{item.nombre}</div>
                      <div className="text-[11px] font-mono text-muted-foreground truncate">
                        {code || <span className="text-destructive">Sin código</span>}
                      </div>
                      {!compat.ok && hasCode && (
                        <div className="flex items-center gap-1 mt-0.5 text-[11px] text-amber-600">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          <span>{compat.reason}</span>
                        </div>
                      )}
                    </div>
                    <Input
                      type="number"
                      min={0}
                      max={999}
                      value={quantities[item.id] ?? 0}
                      onChange={(e) => updateQty(item.id, e.target.value)}
                      disabled={!hasCode || !compat.ok}
                      className="h-8 text-center"
                    />
                  </div>
                )
              })}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Total: <strong>{totalLabels}</strong> etiqueta{totalLabels === 1 ? "" : "s"} — Se imprime en hoja común o rollo térmico. Usá el diálogo de impresión del navegador para elegir la impresora.
          </p>
        </div>

        <DialogFooter className="mt-2 gap-2 sm:gap-2 flex-wrap">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {outputFormat === "PDF" ? (
            <Button onClick={handlePrint} disabled={totalLabels === 0}>
              <Printer className="mr-2 h-4 w-4" />
              Imprimir ({totalLabels})
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleDirectPrint}
                disabled={totalLabels === 0 || !selectedTemplate || !hasWebUsb}
                title={!hasWebUsb ? "WebUSB no soportado por este navegador" : ""}
              >
                <Usb className="mr-2 h-4 w-4" />
                Imprimir directo
              </Button>
              <Button
                onClick={handleDownloadThermal}
                disabled={totalLabels === 0 || !selectedTemplate}
              >
                <Download className="mr-2 h-4 w-4" />
                {`Descargar .${outputFormat.toLowerCase()} (${totalLabels})`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// Sub-componente: configuración + preview térmico (compartido ZPL/EPL)
// ============================================================
interface ThermalConfigProps {
  formato: "ZPL" | "EPL"
  templates: ApiLabelTemplate[]
  selectedId: string
  onSelect: (id: string) => void
  previewSpool: string
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>
  error: string
  okMsg: string
  selectedTemplate: ApiLabelTemplate | null
}

function ThermalConfig({
  formato,
  templates,
  selectedId,
  onSelect,
  previewSpool,
  canvasRef,
  error,
  okMsg,
  selectedTemplate,
}: ThermalConfigProps) {
  if (templates.length === 0) {
    return (
      <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-3">
        <p className="text-sm text-muted-foreground">
          No hay plantillas {formato} configuradas para esta organización.
        </p>
        <Link
          href="/configuracion/label-templates"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <Settings2 className="h-4 w-4" />
          Crear una plantilla
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
        <div className="space-y-1.5">
          <Label>Plantilla {formato}</Label>
          <Select value={selectedId} onValueChange={onSelect}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar plantilla" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.nombre} ({Number(t.ancho_mm)}×{Number(t.alto_mm)}mm @ {t.dpi}dpi)
                  {t.es_default ? " — default" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Link
          href="/configuracion/label-templates"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Gestionar plantillas
        </Link>
      </div>

      {selectedTemplate && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Vista previa visual (aproximada)</Label>
            <div className="border rounded-md bg-white p-2 flex items-center justify-center min-h-[170px]">
              <canvas ref={canvasRef} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Spool raw (primera etiqueta)</Label>
            <Textarea
              value={previewSpool}
              readOnly
              className="font-mono text-[11px] min-h-[170px] resize-none"
            />
          </div>
        </div>
      )}

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {okMsg && (
        <div className="text-sm text-green-700 bg-green-100 dark:bg-green-950/40 dark:text-green-300 rounded-md px-3 py-2">
          {okMsg}
        </div>
      )}
    </div>
  )
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
