import { NextResponse } from "next/server"
import { requirePosAccess, soloVeSusVentas } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateGarantiaVentaPDF } from "@/lib/pdf"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; garantiaId: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requirePosAccess()
    if (error) return error

    const { id, garantiaId } = await params

    // Verificar que la venta existe y pertenece a la organización
    let ventaQuery = supabaseAdmin
      .from("ventas")
      .select(`
        *,
        users:vendedor_id (id, nombre),
        organizations!inner (
          nombre,
          nombre_mostrar,
          telefono,
          direccion,
          logo_url,
          moneda,
          zona_horaria
        )
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (soloVeSusVentas(role)) {
      ventaQuery = ventaQuery.eq("vendedor_id", userId!)
    }

    const { data: venta, error: ventaError } = await ventaQuery.single()

    if (ventaError || !venta) {
      return NextResponse.json(
        { error: "Venta no encontrada" },
        { status: 404 }
      )
    }

    // Una venta anulada se deshizo entera: su garantía no cubre nada, aunque
    // la fila haya quedado ACTIVA (ventas anuladas antes de la migración 334).
    if (venta.estado === "ANULADA") {
      return NextResponse.json(
        { error: "La venta fue anulada: su garantía ya no emite comprobante" },
        { status: 410 }
      )
    }

    // Obtener garantía con item
    const { data: garantia, error: garantiaError } = await supabaseAdmin
      .from("garantias_venta")
      .select(`
        *,
        items_venta (
          *,
          inventario (*)
        )
      `)
      .eq("id", garantiaId)
      .eq("venta_id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (garantiaError || !garantia) {
      return NextResponse.json(
        { error: "Garantía no encontrada" },
        { status: 404 }
      )
    }

    // Una garantía ANULADA se retiró al devolverse el producto (migración 316):
    // emitir su certificado entregaría un papel que dice que la garantía vale
    // cuando la venta ya se reembolsó. 410 y no 404 porque el documento existió
    // y se retiró a propósito — no es un id inventado.
    //
    // VENCIDA y RECLAMADA sí siguen emitiendo: esas garantías existieron y
    // corrieron su plazo, y el cliente conserva el derecho al comprobante.
    if (garantia.estado === "ANULADA") {
      return NextResponse.json(
        { error: "La garantía fue anulada por una devolución y ya no emite comprobante" },
        { status: 410 }
      )
    }

    // Firma: la de quien hizo la venta. Antes se tomaba la de la última orden
    // entregada de toda la organización, así que el certificado salía firmado
    // por alguien que no tuvo nada que ver (otro empleado, otra sucursal). Si el
    // vendedor tiene una firma de entrega guardada se usa esa; si no, el
    // recuadro queda con su nombre para firmar a mano.
    let firmaEncargado: string | null = null
    let firmaEncargadoMime: string | null = null
    const vendedor = venta.users as { id?: string; nombre?: string } | null
    const nombreEncargado: string | null = vendedor?.nombre || null

    if (venta.vendedor_id) {
      const { data: firmaVendedor } = await supabaseAdmin
        .from("ordenes_servicio")
        .select("firma_encargado_entrega, firma_encargado_entrega_mime")
        .eq("organization_id", organizationId!)
        .eq("entregado_por_user_id", venta.vendedor_id)
        .not("firma_encargado_entrega", "is", null)
        .order("fecha_entrega", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (firmaVendedor?.firma_encargado_entrega) {
        firmaEncargado = firmaVendedor.firma_encargado_entrega
        firmaEncargadoMime = firmaVendedor.firma_encargado_entrega_mime || "image/png"
      }
    }

    // Preparar datos para el PDF
    const pdfData = {
      numeroGarantia: garantia.numero_garantia,
      venta: {
        numeroVenta: venta.numero_venta,
        fecha: new Date(venta.created_at),
      },
      cliente: {
        nombre: venta.cliente_nombre,
        telefono: venta.cliente_telefono || "",
      },
      item: {
        descripcion: garantia.items_venta?.descripcion || "",
        cantidad: garantia.items_venta?.cantidad || 1,
        marca: garantia.items_venta?.inventario?.nombre || null,
      },
      diasValidez: garantia.dias_validez,
      fechaInicio: new Date(garantia.fecha_inicio),
      fechaVencimiento: new Date(garantia.fecha_vencimiento),
      nombreEmpresa: venta.organizations?.nombre_mostrar || venta.organizations?.nombre,
      telefonoEmpresa: venta.organizations?.telefono,
      direccionEmpresa: venta.organizations?.direccion,
      logoUrl: venta.organizations?.logo_url,
      moneda: venta.organizations?.moneda || "ARS",
      zonaHoraria: venta.organizations?.zona_horaria || "America/Argentina/Buenos_Aires",
      firmaEncargado,
      firmaEncargadoMime,
      nombreEncargado,
    }

    // Generar PDF
    const pdfBuffer = await generateGarantiaVentaPDF(pdfData)

    // Retornar PDF
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="garantia-${garantia.numero_garantia}.pdf"`,
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (error) {
    console.error("Error generating garantia PDF:", error)
    return NextResponse.json(
      { error: "Error al generar certificado de garantía" },
      { status: 500 }
    )
  }
}
