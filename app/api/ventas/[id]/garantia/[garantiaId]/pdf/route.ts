import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateGarantiaVentaPDF } from "@/lib/pdf"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; garantiaId: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { id, garantiaId } = await params

    // Verificar que la venta existe y pertenece a la organización
    let ventaQuery = supabaseAdmin
      .from("ventas")
      .select(`
        *,
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

    if (role === "VENDEDOR") {
      ventaQuery = ventaQuery.eq("vendedor_id", userId!)
    }

    const { data: venta, error: ventaError } = await ventaQuery.single()

    if (ventaError || !venta) {
      return NextResponse.json(
        { error: "Venta no encontrada" },
        { status: 404 }
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
    }

    // Generar PDF
    const pdfBuffer = await generateGarantiaVentaPDF(pdfData)

    // Retornar PDF
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="garantia-${garantia.numero_garantia}.pdf"`,
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
