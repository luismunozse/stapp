import { supabaseAdmin } from "@/lib/supabase"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"
import { rowsToCsv } from "./export-csv"
import { buildZipStream } from "./zip"

// Topes del spec. Son constantes del módulo: se ajustan si las pruebas reales
// muestran que entran más dentro de los 60 s.
export const MAX_PDFS = 300
export const MAX_PDF_BYTES = 100 * 1024 * 1024
export const EXPORT_BUDGET_MS = 50_000

// pdf_url es un link del proveedor de facturación (TusFacturas), no un archivo
// nuestro. Solo se descargan hosts conocidos; el resto va a pdfs-pendientes.csv.
export const PDF_ALLOWED_HOST_SUFFIXES = ["tusfacturas.app"]

const PDF_FETCH_TIMEOUT_MS = 10_000
const PAGE = 1000
const IN_CHUNK = 200

const MOTIVO_TOPE = "tope de archivos o tamaño"
const MOTIVO_TIEMPO = "se acabó el tiempo"
const MOTIVO_SIN_LINK = "sin link de PDF (emitido directo en ARCA)"

type Row = Record<string, unknown>
export interface PdfSource { id: string; numero: string | null; pdf_url: string | null }
export interface PendingPdf { comprobante: string; url: string; motivo: string }

export function isAllowedPdfUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return (
      u.protocol === "https:" &&
      u.port === "" &&
      u.username === "" &&
      u.password === "" &&
      PDF_ALLOWED_HOST_SUFFIXES.some((s) => u.hostname === s || u.hostname.endsWith(`.${s}`))
    )
  } catch {
    return false
  }
}

export async function fetchAllRows(table: string, select: string, apply: (q: any) => any): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await apply(supabaseAdmin.from(table).select(select))
      .order("id")
      .range(from, from + PAGE - 1)
    // Un error no puede degradar a un CSV vacío: el respaldo falla entero.
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...((data ?? []) as Row[]))
    if (!data || data.length < PAGE) break
  }
  return rows
}

type Download = { bytes: Uint8Array } | { error: string }

async function downloadPdf(
  url: string,
  fetchImpl: typeof fetch,
  maxBytes: number,
  timeoutMs: number
): Promise<Download> {
  // Si el timeout lo fija el deadline (no el tope por PDF), un abort es falta de tiempo.
  const boundByDeadline = timeoutMs < PDF_FETCH_TIMEOUT_MS
  if (!isAllowedPdfUrl(url)) return { error: "host no permitido" }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    // redirect: "error" — un 30x hacia otro host saltearía la allowlist.
    const res = await fetchImpl(url, { signal: ctrl.signal, redirect: "error" })
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      return { error: `HTTP ${res.status}` }
    }

    const declared = Number(res.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel().catch(() => {})
      return { error: MOTIVO_TOPE }
    }
    if (!res.body) return { error: "no se pudo descargar" }

    // Content-Length no alcanza (puede faltar o mentir): se corta la lectura
    // apenas lo recibido supera el presupuesto restante.
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.length
      if (received > maxBytes) {
        await reader.cancel().catch(() => {})
        return { error: MOTIVO_TOPE }
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(received)
    let offset = 0
    for (const c of chunks) {
      bytes.set(c, offset)
      offset += c.length
    }
    return { bytes }
  } catch {
    return { error: ctrl.signal.aborted && boundByDeadline ? MOTIVO_TIEMPO : "no se pudo descargar" }
  } finally {
    clearTimeout(timer)
  }
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_")

export async function collectPdfs(
  rows: PdfSource[],
  deadline: number,
  opts: { fetchImpl?: typeof fetch; maxFiles?: number; maxBytes?: number } = {}
): Promise<{ files: Array<{ name: string; bytes: Uint8Array }>; pending: PendingPdf[] }> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const maxFiles = opts.maxFiles ?? MAX_PDFS
  const maxBytes = opts.maxBytes ?? MAX_PDF_BYTES
  const files: Array<{ name: string; bytes: Uint8Array }> = []
  const pending: PendingPdf[] = []
  let total = 0

  const label = (r: PdfSource) => r.numero ?? r.id

  // Secuencial: los topes de cantidad, bytes y tiempo se chequean ANTES de
  // cada descarga, así nunca se baja algo que ya se sabe que no entra.
  for (const r of rows) {
    if (!r.pdf_url) {
      pending.push({ comprobante: label(r), url: "", motivo: MOTIVO_SIN_LINK })
      continue
    }
    const url = r.pdf_url
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      pending.push({ comprobante: label(r), url, motivo: MOTIVO_TIEMPO })
      continue
    }
    if (files.length >= maxFiles || total >= maxBytes) {
      pending.push({ comprobante: label(r), url, motivo: MOTIVO_TOPE })
      continue
    }

    const res = await downloadPdf(url, fetchImpl, maxBytes - total, Math.min(PDF_FETCH_TIMEOUT_MS, remainingMs))
    if ("error" in res) {
      pending.push({ comprobante: label(r), url, motivo: res.error })
      continue
    }
    total += res.bytes.length
    files.push({ name: `${safeName(label(r))}-${safeName(r.id)}.pdf`, bytes: res.bytes })
  }
  return { files, pending }
}

export function buildReadme(p: {
  orgNombre: string
  slug: string
  generadoEn: Date
  pdfIncluidos: number
  pendientes: number
}): string {
  const fecha = p.generadoEn.toLocaleString("es-AR", { timeZone: DEFAULT_TIMEZONE })
  const lines = [
    `Respaldo de ${p.orgNombre} (${p.slug})`,
    `Generado: ${fecha}`,
    "",
    "Contenido:",
    "- clientes.csv, ventas.csv, ventas_items.csv, ventas_pagos.csv",
    "- facturas.csv, notas_credito.csv, cuenta_corriente.csv",
    "- comprobantes_fiscales.csv (comprobantes electrónicos emitidos)",
    `- comprobantes_pdf/ (${p.pdfIncluidos} PDF)`,
    "",
    "IMPORTANTE: conservar la documentación fiscal emitida es obligación del taller.",
    "STApp no la retiene una vez completada la eliminación de la cuenta.",
  ]
  if (p.pendientes > 0) {
    lines.push(
      "",
      `AVISO: ${p.pendientes} PDF no se incluyeron en este archivo (tope de cantidad o tamaño, tiempo, o link no descargable).`,
      "Están listados con su link en pdfs-pendientes.csv. Descargalos desde esos links antes de que se complete la eliminación."
    )
  }
  return lines.join("\r\n") + "\r\n"
}

async function fetchByVentaIds(table: string, ventaIds: string[]): Promise<Row[]> {
  const out: Row[] = []
  for (let i = 0; i < ventaIds.length; i += IN_CHUNK) {
    const chunk = ventaIds.slice(i, i + IN_CHUNK)
    out.push(...(await fetchAllRows(table, "*", (q) => q.in("venta_id", chunk))))
  }
  return out
}

// Sin provider_response: es la respuesta cruda del proveedor y puede traer datos que no son del taller.
const COMPROBANTES_COLUMNS =
  "id, venta_id, tipo, punto_venta, numero, cae, cae_vencimiento, estado, pdf_url, receptor_doc_tipo, receptor_doc_nro, receptor_condicion_iva, total, provider, error_msg, created_at, updated_at"

// Un monto como string con signo ("-50") se prefijaría con `'` en el CSV
// (anti-fórmulas) y en un respaldo fiscal los negativos son notas de crédito.
function amountsAsNumbers(rows: Row[], fields: string[]): Row[] {
  return rows.map((r) => {
    const out = { ...r }
    for (const f of fields) {
      const v = out[f]
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) out[f] = Number(v)
    }
    return out
  })
}

export function buildOrganizationExportStream(
  org: { id: string; nombre: string; slug: string },
  opts: { fetchImpl?: typeof fetch } = {}
): ReadableStream<Uint8Array> {
  return buildZipStream(async (zip) => {
    const deadline = Date.now() + EXPORT_BUDGET_MS
    const byOrg = (q: any) => q.eq("organization_id", org.id)

    zip.addText("clientes.csv", rowsToCsv(await fetchAllRows("clientes", "*", byOrg)))

    const ventas = await fetchAllRows("ventas", "*", byOrg)
    zip.addText("ventas.csv", rowsToCsv(ventas))
    const ventaIds = ventas.map((v) => String(v.id))
    zip.addText("ventas_items.csv", rowsToCsv(await fetchByVentaIds("items_venta", ventaIds)))
    zip.addText("ventas_pagos.csv", rowsToCsv(await fetchByVentaIds("pagos_venta", ventaIds)))

    // facturas tiene organization_id propio (migración 250); las de venta POS
    // tienen orden_id NULL, así que unir por ordenes_servicio las perdería.
    const facturas = await fetchAllRows("facturas", "*", byOrg)
    zip.addText(
      "facturas.csv",
      rowsToCsv(amountsAsNumbers(facturas, ["subtotal", "iva", "total", "monto_abonado"]))
    )

    const notas = await fetchAllRows("notas_credito", "*", byOrg)
    zip.addText("notas_credito.csv", rowsToCsv(amountsAsNumbers(notas, ["monto"])))
    const cc = await fetchAllRows("cuenta_corriente", "*", byOrg)
    zip.addText("cuenta_corriente.csv", rowsToCsv(amountsAsNumbers(cc, ["monto", "saldo_posterior"])))

    const comprobantes = amountsAsNumbers(
      await fetchAllRows("comprobantes_fiscales", COMPROBANTES_COLUMNS, byOrg),
      ["total"]
    )
    zip.addText("comprobantes_fiscales.csv", rowsToCsv(comprobantes))

    const { files, pending } = await collectPdfs(
      comprobantes
        .filter((c) => c.estado === "emitido")
        .map((c) => ({
          id: String(c.id),
          numero: (c.numero as string | null) ?? null,
          pdf_url: (c.pdf_url as string | null) ?? null,
        })),
      deadline,
      { fetchImpl: opts.fetchImpl }
    )
    for (const f of files) zip.addBytes(`comprobantes_pdf/${f.name}`, f.bytes, { store: true })
    if (pending.length > 0) zip.addText("pdfs-pendientes.csv", rowsToCsv(pending as unknown as Row[]))

    zip.addText(
      "LEEME.txt",
      buildReadme({
        orgNombre: org.nombre,
        slug: org.slug,
        generadoEn: new Date(),
        pdfIncluidos: files.length,
        pendientes: pending.length,
      })
    )
  })
}
