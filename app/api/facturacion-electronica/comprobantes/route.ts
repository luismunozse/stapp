import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { isMissingColumnError } from "@/lib/db-errors"
import { canEmitirFacturaElectronica } from "@/lib/facturacion/access"
import { SAFE_COLUMNS, SNAPSHOT_COLUMNS } from "@/lib/facturacion/comprobante-columns"
import { pdfFiscalDisponible } from "@/lib/facturacion/arca/qr"

const ESTADOS = ["pendiente", "emitido", "rechazado"] as const
const LIMIT_DEFAULT = 20
const LIMIT_MAX = 100

// El embed trae el numero de venta para linkear desde el listado (FK venta_id).
const EMBED_VENTA = "ventas(numero_venta)"

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

  const offset = (page - 1) * limit
  const buscar = (conFoto: boolean) => {
    // Jamas provider_response: es la respuesta cruda del proveedor.
    let query = supabaseAdmin
      .from("comprobantes_fiscales")
      .select(conFoto ? `${SAFE_COLUMNS}, ${SNAPSHOT_COLUMNS}, ${EMBED_VENTA}` : `${SAFE_COLUMNS}, ${EMBED_VENTA}`, {
        count: "exact",
      })
      .eq("organization_id", organizationId!)
    if (estado) query = query.eq("estado", estado)
    if (ventaId) query = query.eq("venta_id", ventaId)
    return query.order("created_at", { ascending: false }).range(offset, offset + limit - 1)
  }

  let { data, error: dbError, count } = await buscar(true)
  if (dbError && isMissingColumnError(dbError)) {
    // Migracion de la foto fiscal sin aplicar (42703): se lista igual, con
    // pdfDisponible=false porque sin foto no hay QR valido.
    ;({ data, error: dbError, count } = await buscar(false))
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
    pdfDisponible: r.estado === "emitido" && pdfFiscalDisponible(r),
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
