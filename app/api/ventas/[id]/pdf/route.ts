import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateVentaPDF } from "@/lib/pdf"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { id } = await params

    // Obtener venta con relaciones
    let query = supabaseAdmin
      .from("ventas")
      .select(`
        *,
        clientes (*),
        users:vendedor_id (id, nombre),
        items_venta (*, inventario (*)),
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

    // Vendedores solo pueden ver sus propias ventas
    if (role === "VENDEDOR") {
      query = query.eq("vendedor_id", userId!)
    }

    const { data: venta, error: dbError } = await query.single()

    if (dbError) {
      if (dbError.code === "PGRST116") {
        return NextResponse.json(
          { error: "Venta no encontrada" },
          { status: 404 }
        )
      }
      throw dbError
    }

    // Preparar datos para el PDF
    const pdfData = {
      numeroVenta: venta.numero_venta,
      fecha: new Date(venta.created_at),
      cliente: {
        nombre: venta.cliente_nombre,
        telefono: venta.cliente_telefono || "",
      },
      vendedor: venta.users?.nombre || "N/A",
      items: venta.items_venta?.map((item: any) => ({
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precioUnitario: parseFloat(item.precio_unitario),
        subtotal: parseFloat(item.subtotal),
        diasGarantia: item.dias_garantia,
      })) || [],
      subtotal: parseFloat(venta.subtotal),
      descuento: parseFloat(venta.descuento),
      total: parseFloat(venta.total),
      metodoPago: venta.metodo_pago,
      nombreEmpresa: venta.organizations?.nombre_mostrar || venta.organizations?.nombre,
      telefonoEmpresa: venta.organizations?.telefono,
      direccionEmpresa: venta.organizations?.direccion,
      logoUrl: venta.organizations?.logo_url,
      moneda: venta.organizations?.moneda || "ARS",
      zonaHoraria: venta.organizations?.zona_horaria || "America/Argentina/Buenos_Aires",
    }

    // Generar PDF
    const pdfBuffer = await generateVentaPDF(pdfData)

    // Retornar PDF
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="venta-${venta.numero_venta}.pdf"`,
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (error) {
    console.error("Error generating venta PDF:", error)
    return NextResponse.json(
      { error: "Error al generar PDF de venta" },
      { status: 500 }
    )
  }
}
