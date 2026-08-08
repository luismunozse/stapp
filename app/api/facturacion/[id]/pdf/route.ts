import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { generateFacturaPDF } from "@/lib/pdf"

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
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 })
    }

    let pdfData: Record<string, any>

    if (base.orden_id) {
      let query = supabaseAdmin
        .from("facturas")
        .select(`
          *,
          ordenes_servicio!inner (
            id, numero_orden, codigo_orden, dispositivo, organization_id, sucursal_id,
            clientes (nombre, telefono, email, direccion),
            organizations (nombre, nombre_mostrar, telefono, direccion, logo_url, moneda, zona_horaria)
          ),
          pagos_parciales (*)
        `)
        .eq("id", id)
        .eq("ordenes_servicio.organization_id", organizationId!)
      if (!verTodas && sid) query = query.eq("ordenes_servicio.sucursal_id", sid)
      const { data: factura, error: dbError } = await query.single()
      if (dbError || !factura) {
        return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 })
      }
      const org = factura.ordenes_servicio.organizations
      const cliente = factura.ordenes_servicio.clientes
      const items = await fetchItemsFactura(id)
      pdfData = {
        numeroFactura: factura.numero_factura,
        fecha: new Date(factura.fecha),
        estadoPago: factura.estado_pago,
        cliente: {
          nombre: cliente?.nombre || "Consumidor Final",
          telefono: cliente?.telefono,
          email: cliente?.email,
          direccion: cliente?.direccion,
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
        zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
      }
    } else {
      let query = supabaseAdmin
        .from("facturas")
        .select(`
          *,
          ventas!inner (
            id, numero_venta, cliente_nombre, descuento, redondeo_monto, organization_id, sucursal_id,
            organizations (nombre, nombre_mostrar, telefono, direccion, logo_url, moneda, zona_horaria)
          ),
          pagos_parciales (*)
        `)
        .eq("id", id)
        .eq("ventas.organization_id", organizationId!)
      if (!verTodas && sid) query = query.eq("ventas.sucursal_id", sid)
      const { data: factura, error: dbError } = await query.single()
      if (dbError || !factura) {
        return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 })
      }
      const org = factura.ventas.organizations
      const items = await fetchItemsFactura(id)
      pdfData = {
        numeroFactura: factura.numero_factura,
        fecha: new Date(factura.fecha),
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
        zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
      }
    }

    // Generar PDF
    const pdfBuffer = await generateFacturaPDF(pdfData as any)

    // Retornar PDF inline (para ver en navegador)
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="factura-${pdfData.numeroFactura}.pdf"`,
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (error) {
    console.error("Error generating factura PDF:", error)
    return NextResponse.json(
      { error: "Error al generar PDF de factura" },
      { status: 500 }
    )
  }
}
