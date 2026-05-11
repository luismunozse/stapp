"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
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
import { Printer, AlertTriangle } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

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
  const [size, setSize] = useState<LabelSize>("50x30")
  const [format, setFormat] = useState<BarcodeFormat>("AUTO")
  const [showName, setShowName] = useState(true)
  const [showPrice, setShowPrice] = useState(true)
  const [showCode, setShowCode] = useState(true)
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((i) => [i.id, 1]))
  )

  const sizeConfig = LABEL_SIZES[size]

  // Cero cantidad para items incompatibles con formato actual.
  // Evita que click "Imprimir" tire alert por items que el usuario no ve descartados.
  useEffect(() => {
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
  }, [format, items])

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

          <div className="border rounded-md">
            <div className="grid grid-cols-[1fr_90px] gap-2 px-3 py-2 text-xs font-medium text-muted-foreground border-b bg-muted/40">
              <span>Producto</span>
              <span className="text-center">Cantidad</span>
            </div>
            <div className="divide-y max-h-[280px] overflow-y-auto">
              {items.map((item) => {
                const code = item.barcode || item.codigo || ""
                const hasCode = !!code
                const compat = hasCode ? checkCompatibility(code, format) : { ok: false, reason: "Sin código" }
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

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handlePrint} disabled={totalLabels === 0}>
            <Printer className="mr-2 h-4 w-4" />
            Imprimir ({totalLabels})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
