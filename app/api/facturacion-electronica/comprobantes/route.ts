import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { isMissingColumnError } from "@/lib/db-errors"
import { canEmitirFacturaElectronica } from "@/lib/facturacion/access"
import { NC_COLUMNS, SAFE_COLUMNS, SNAPSHOT_COLUMNS } from "@/lib/facturacion/comprobante-columns"
import { esFacturaAnulable, esNotaCreditoVerificable } from "@/lib/facturacion/anulable"
import { esNotaCreditoFiscal } from "@/lib/facturacion/cbte-tipo"
import { pdfFiscalDisponible } from "@/lib/facturacion/arca/qr"

const FORMA_ID = /^[A-Za-z0-9_-]{1,64}$/
const ESTADOS = ["pendiente", "emitido", "rechazado", "anulado"] as const
const LIMIT_DEFAULT = 20
const LIMIT_MAX = 100

// El embed trae el numero de venta para linkear desde el listado (FK venta_id).
const EMBED_VENTA = "ventas(numero_venta)"

// Cada migracion que agrega columnas es un escalon: si el SELECT falla con 42703
// se baja al siguiente, que nombra menos columnas. Lista las NC y las facturas
// anuladas (371) > la foto fiscal (QR/PDF) > solo lo seguro. Una columna nueva
// que se pide sin escalon de respaldo tumba el listado entero antes de la migracion.
const SELECTS = [
  `${SAFE_COLUMNS}, ${SNAPSHOT_COLUMNS}, ${NC_COLUMNS}, ${EMBED_VENTA}`,
  `${SAFE_COLUMNS}, ${SNAPSHOT_COLUMNS}, ${EMBED_VENTA}`,
  `${SAFE_COLUMNS}, ${EMBED_VENTA}`,
] as const

/** Entero >= 1 o null si el valor no lo es. `null` (param ausente) usa el default. */
function enteroPositivo(valor: string | null, porDefecto: number): number | null {
  if (valor === null) return porDefecto
  if (!/^\d+$/.test(valor.trim())) return null
  const n = Number(valor)
  return n >= 1 ? n : null
}

// GET - Listado de comprobantes fiscales de la org. No depende del plan ni del
// toggle: el historial tiene que seguir legible despues de un downgrade.
// `puedeEmitir` le dice a la UI si ademas se puede emitir hoy.
export async function GET(request: Request) {
  const { error, organizationId } = await requireAdmin()
  if (error) return error

  const { searchParams } = new URL(request.url)
  const page = enteroPositivo(searchParams.get("page"), 1)
  const limitPedido = enteroPositivo(searchParams.get("limit"), LIMIT_DEFAULT)
  if (page === null || limitPedido === null) {
    return NextResponse.json({ error: "Paginación inválida" }, { status: 400 })
  }
  const limit = Math.min(limitPedido, LIMIT_MAX)

  const estado = searchParams.get("estado")
  if (estado !== null && !(ESTADOS as readonly string[]).includes(estado)) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 })
  }
  const ventaId = searchParams.get("ventaId")
  // Los ids de venta son TEXT (cuid): una forma imposible no tiene nada que buscar.
  if (ventaId && !FORMA_ID.test(ventaId)) {
    return NextResponse.json({ error: "ventaId inválido" }, { status: 400 })
  }

  const offset = (page - 1) * limit
  // Las NC se listan junto a las facturas: ningun filtro sobre cbte_tipo.
  const buscar = (escalon: number) => {
    // Jamas provider_response: es la respuesta cruda del proveedor.
    let query = supabaseAdmin
      .from("comprobantes_fiscales")
      .select(SELECTS[escalon], { count: "exact" })
      .eq("organization_id", organizationId!)
    if (estado) query = query.eq("estado", estado)
    if (ventaId) query = query.eq("venta_id", ventaId)
    return query.order("created_at", { ascending: false }).range(offset, offset + limit - 1)
  }

  let escalon = 0
  let { data, error: dbError, count } = await buscar(escalon)
  while (dbError && isMissingColumnError(dbError) && escalon < SELECTS.length - 1) {
    if (estado === "anulado") {
      // Sin la migracion de la anulacion no existen facturas anuladas: los
      // escalones de respaldo no deben inventarlas.
      ;({ data, error: dbError, count } = { data: [], error: null, count: 0 })
      break
    }
    // Sin foto fiscal (o sin la 371) se lista igual; pdfDisponible=false cuando
    // falta la foto, porque sin ella no hay QR valido.
    escalon++
    ;({ data, error: dbError, count } = await buscar(escalon))
  }
  if (dbError?.code === "22P02") {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 })
  }
  if (dbError) {
    console.error("Error listing comprobantes fiscales:", dbError)
    return NextResponse.json({ error: "No se pudieron cargar los comprobantes" }, { status: 500 })
  }

  // Fail-closed: ante cualquier falla de la verificacion no se ofrece emitir.
  let puedeEmitir = false
  try {
    puedeEmitir = (await canEmitirFacturaElectronica(organizationId!)) === true
  } catch {
    puedeEmitir = false
  }

  const total = count ?? 0
  const items = ((data ?? []) as unknown as Record<string, any>[]).map((r) => ({
    id: r.id,
    ventaId: r.venta_id,
    numeroVenta: r.ventas?.numero_venta ?? null,
    tipo: r.tipo,
    puntoVenta: r.punto_venta,
    numero: r.numero,
    cae: r.cae,
    caeVencimiento: r.cae_vencimiento,
    estado: r.estado,
    total: r.total,
    errorMsg: r.error_msg,
    pdfUrl: r.pdf_url,
    fechaEmision: r.fecha_emision ?? null,
    createdAt: r.created_at,
    // Una factura anulada sigue siendo un comprobante emitido: se puede reimprimir.
    pdfDisponible: (r.estado === "emitido" || r.estado === "anulado") && pdfFiscalDisponible(r),
    cbteTipo: r.cbte_tipo ?? null,
    esNotaCredito: esNotaCreditoFiscal(r.cbte_tipo),
    comprobanteAsociadoId: r.comprobante_asociado_id ?? null,
    anuladoAt: r.anulado_at ?? null,
    motivo: r.motivo ?? null,
    motivoDetalle: r.motivo_detalle ?? null,
    anulable: esFacturaAnulable(r),
    verificable: esNotaCreditoVerificable(r),
  }))

  return NextResponse.json({
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    puedeEmitir,
  })
}
