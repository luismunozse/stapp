import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { generateFacturaPDF } from "@/lib/pdf"
import { addDaysInTimeZone } from "@/lib/timezone"
import { isMissingColumnError } from "@/lib/db-errors"

// Org columns for the emisor block, with and without the fiscal identity /
// collection fields added by migration 295 (cuit, condicion_iva,
// domicilio_fiscal, cbu_alias, medios_pago_texto, plazo_pago_dias). Split so
// a PGRST204 on those 6 new columns (migration not applied yet on this DB)
// only drops the fiscal block from the remito instead of breaking PDF
// generation entirely — see the retry in each branch of GET below.
const ORG_COLS = "nombre, nombre_mostrar, telefono, direccion, logo_url, moneda, zona_horaria"
const ORG_COLS_FISCAL = `${ORG_COLS}, cuit, condicion_iva, domicilio_fiscal, cbu_alias, medios_pago_texto, plazo_pago_dias`

function fetchFacturaOrden(
  id: string,
  organizationId: string,
  sid: string | null,
  verTodas: boolean,
  withFiscal: boolean
) {
  let query = supabaseAdmin
    .from("facturas")
    .select(`
      *,
      ordenes_servicio!inner (
        id, numero_orden, codigo_orden, dispositivo, organization_id, sucursal_id, fecha_ingreso,
        clientes (nombre, telefono, email, direccion, dni),
        organizations (${withFiscal ? ORG_COLS_FISCAL : ORG_COLS})
      ),
      pagos_parciales (*)
    `)
    .eq("id", id)
    .eq("ordenes_servicio.organization_id", organizationId)
  if (!verTodas && sid) query = query.eq("ordenes_servicio.sucursal_id", sid)
  return query.single()
}

function fetchFacturaVenta(
  id: string,
  organizationId: string,
  sid: string | null,
  verTodas: boolean,
  withFiscal: boolean
) {
  let query = supabaseAdmin
    .from("facturas")
    .select(`
      *,
      ventas!inner (
        id, numero_venta, cliente_nombre, descuento, redondeo_monto, organization_id, sucursal_id, created_at,
        organizations (${withFiscal ? ORG_COLS_FISCAL : ORG_COLS})
      ),
      pagos_parciales (*)
    `)
    .eq("id", id)
    .eq("ventas.organization_id", organizationId)
  if (!verTodas && sid) query = query.eq("ventas.sucursal_id", sid)
  return query.single()
}

/**
 * vencimiento = fecha de emisión + plazo_pago_dias (net terms), calculado en
 * la zona horaria del emisor. Solo se computa si la org cargó un plazo — un
 * remito sin plazo definido simplemente no muestra vencimiento (ver el
 * bloque condicional en lib/pdf.ts).
 */
function calcularVencimiento(
  fecha: string,
  plazoPagoDias: number | null | undefined,
  zonaHoraria: string
): string | undefined {
  if (plazoPagoDias == null) return undefined
  return addDaysInTimeZone(plazoPagoDias, zonaHoraria, new Date(fecha))
}

// Fetches items_factura for a factura already confirmed to belong to the
// caller's org (called only after the org-scoped branch query above
// succeeds — supabaseAdmin is service-role and bypasses RLS, so this must
// not run before that check).
async function fetchItemsFactura(facturaId: string) {
  const { data } = await supabaseAdmin
    .from("items_factura")
    .select("descripcion, cantidad, precio_unitario, subtotal, tipo")
    .eq("factura_id", facturaId)
    .order("created_at", { ascending: true })

  return (data || []).map((i: any) => ({
    descripcion: i.descripcion,
    cantidad: i.cantidad,
    precioUnitario: parseFloat(i.precio_unitario),
    subtotal: parseFloat(i.subtotal),
  }))
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, session, role } = await requireAdmin()
    if (error) return error

    const filtro = await sucursalParaLectura({
      role,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    const verTodas = filtro.verTodas
    const sid = verTodas ? null : filtro.sucursalId

    const { id } = await params

    const { data: base, error: baseError } = await supabaseAdmin
      .from("facturas")
      .select("id, orden_id, venta_id")
      .eq("id", id)
      .single()

    if (baseError || !base) {
      return NextResponse.json({ error: "Remito no encontrado" }, { status: 404 })
    }

    let pdfData: Record<string, any>

    if (base.orden_id) {
      let { data: factura, error: dbError } = await fetchFacturaOrden(id, organizationId!, sid, verTodas, true)
      if (isMissingColumnError(dbError)) {
        // Migración 295 (datos fiscales) no aplicada todavía en este entorno.
        // SELECT pura (sin .update()): Postgres devuelve 42703, no PGRST204.
        ;({ data: factura, error: dbError } = await fetchFacturaOrden(id, organizationId!, sid, verTodas, false))
      }
      if (dbError || !factura) {
        return NextResponse.json({ error: "Remito no encontrado" }, { status: 404 })
      }
      const org = factura.ordenes_servicio.organizations
      const cliente = factura.ordenes_servicio.clientes
      const items = await fetchItemsFactura(id)
      const zonaHoraria = org?.zona_horaria || "America/Argentina/Buenos_Aires"
      pdfData = {
        numeroFactura: factura.numero_factura,
        fecha: new Date(factura.fecha),
        // Accounting-grade remito: the date the goods/service actually
        // moved (order intake), which can differ from `fecha` (emission).
        // Guarded because fecha_ingreso has no NOT NULL constraint —
        // `new Date(null)` would silently become the 1970 epoch otherwise.
        fechaOperacion: factura.ordenes_servicio.fecha_ingreso
          ? new Date(factura.ordenes_servicio.fecha_ingreso)
          : undefined,
        estadoPago: factura.estado_pago,
        cliente: {
          nombre: cliente?.nombre || "Consumidor Final",
          telefono: cliente?.telefono,
          email: cliente?.email,
          direccion: cliente?.direccion,
          dni: cliente?.dni,
        },
        orden: {
          numeroOrden: factura.ordenes_servicio.numero_orden,
          codigoOrden: factura.ordenes_servicio.codigo_orden,
          dispositivo: factura.ordenes_servicio.dispositivo,
        },
        items,
        subtotal: parseFloat(factura.subtotal),
        iva: parseFloat(factura.iva),
        total: parseFloat(factura.total),
        montoAbonado: parseFloat(factura.monto_abonado || "0"),
        pagos: (factura.pagos_parciales || [])
          .sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
          .map((p: any) => ({
            monto: parseFloat(p.monto),
            metodoPago: p.metodo_pago,
            fecha: new Date(p.fecha),
            referencia: p.numero_referencia,
            cuotas: p.cuotas,
            recargoPorcentaje: p.recargo_porcentaje ? parseFloat(p.recargo_porcentaje) : null,
            montoOriginal: p.monto_original ? parseFloat(p.monto_original) : null,
          })),
        nombreEmpresa: org?.nombre_mostrar || org?.nombre,
        telefonoEmpresa: org?.telefono,
        direccionEmpresa: org?.direccion,
        logoUrl: org?.logo_url,
        moneda: org?.moneda || "ARS",
        zonaHoraria,
        cuitEmpresa: org?.cuit,
        condicionIvaEmpresa: org?.condicion_iva,
        domicilioFiscalEmpresa: org?.domicilio_fiscal,
        cbuAlias: org?.cbu_alias,
        mediosPago: org?.medios_pago_texto,
        vencimiento: calcularVencimiento(factura.fecha, org?.plazo_pago_dias, zonaHoraria),
      }
    } else {
      let { data: factura, error: dbError } = await fetchFacturaVenta(id, organizationId!, sid, verTodas, true)
      if (isMissingColumnError(dbError)) {
        // Migración 295 (datos fiscales) no aplicada todavía en este entorno.
        // SELECT pura (sin .update()): Postgres devuelve 42703, no PGRST204.
        ;({ data: factura, error: dbError } = await fetchFacturaVenta(id, organizationId!, sid, verTodas, false))
      }
      if (dbError || !factura) {
        return NextResponse.json({ error: "Remito no encontrado" }, { status: 404 })
      }
      const org = factura.ventas.organizations
      const items = await fetchItemsFactura(id)
      const zonaHoraria = org?.zona_horaria || "America/Argentina/Buenos_Aires"
      pdfData = {
        numeroFactura: factura.numero_factura,
        fecha: new Date(factura.fecha),
        // Accounting-grade remito: the date the sale actually happened,
        // which can differ from `fecha` (emission). Guarded the same way
        // as the orden branch above.
        fechaOperacion: factura.ventas.created_at
          ? new Date(factura.ventas.created_at)
          : undefined,
        estadoPago: factura.estado_pago,
        cliente: { nombre: factura.ventas.cliente_nombre || "Consumidor Final" },
        venta: { numeroVenta: factura.ventas.numero_venta },
        descuento: parseFloat(factura.ventas.descuento || "0"),
        redondeo: parseFloat(factura.ventas.redondeo_monto || "0"),
        items,
        subtotal: parseFloat(factura.subtotal),
        iva: parseFloat(factura.iva),
        total: parseFloat(factura.total),
        montoAbonado: parseFloat(factura.monto_abonado || "0"),
        pagos: [],
        nombreEmpresa: org?.nombre_mostrar || org?.nombre,
        telefonoEmpresa: org?.telefono,
        direccionEmpresa: org?.direccion,
        logoUrl: org?.logo_url,
        moneda: org?.moneda || "ARS",
        zonaHoraria,
        cuitEmpresa: org?.cuit,
        condicionIvaEmpresa: org?.condicion_iva,
        domicilioFiscalEmpresa: org?.domicilio_fiscal,
        cbuAlias: org?.cbu_alias,
        mediosPago: org?.medios_pago_texto,
        vencimiento: calcularVencimiento(factura.fecha, org?.plazo_pago_dias, zonaHoraria),
      }
    }

    // Generar PDF
    const pdfBuffer = await generateFacturaPDF(pdfData as any)

    // Retornar PDF inline (para ver en navegador)
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="remito-${pdfData.numeroFactura}.pdf"`,
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (error) {
    console.error("Error generating factura PDF:", error)
    return NextResponse.json(
      { error: "Error al generar PDF de remito" },
      { status: 500 }
    )
  }
}
