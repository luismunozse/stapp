import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateComprobanteEntregaPDF } from "@/lib/pdf"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    // Obtener orden con datos necesarios
    const { data: orden, error: fetchError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        *,
        clientes(*),
        users:entregado_por_user_id(id, nombre, email)
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    // Verificar que la orden fue entregada
    if (orden.estado !== "ENTREGADO" || !orden.firma_cliente_entrega) {
      return NextResponse.json({ error: "La orden no tiene datos de entrega" }, { status: 400 })
    }

    // Obtener datos de la organizacion
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("nombre, telefono, direccion, logo_url")
      .eq("id", organizationId!)
      .single()

    const cliente = orden.clientes as any
    const entregadoPor = orden.users as any

    // Mapeo de tipos de dispositivo
    const tipoLabels: Record<string, string> = {
      CELULAR: "Celular",
      COMPUTADORA: "Computadora",
      TABLET: "Tablet",
      CONSOLA: "Consola",
      SMARTWATCH: "Smartwatch",
    }

    const pdfBuffer = await generateComprobanteEntregaPDF({
      numeroOrden: orden.numero_orden,
      codigoOrden: orden.codigo_orden,
      fechaIngreso: new Date(orden.fecha_ingreso),
      fechaEntrega: new Date(orden.fecha_entrega),
      cliente: {
        nombre: cliente?.nombre || "Sin nombre",
        telefono: cliente?.telefono || "",
        email: cliente?.email,
      },
      dispositivo: orden.dispositivo,
      tipoDispositivo: tipoLabels[orden.tipo_dispositivo] || orden.tipo_dispositivo,
      marca: orden.marca,
      problemaReportado: orden.problema_reportado,
      diagnostico: orden.diagnostico,
      firmaClienteEntrega: orden.firma_cliente_entrega,
      firmaClienteMime: orden.firma_cliente_entrega_mime || "image/png",
      firmaEncargadoEntrega: orden.firma_encargado_entrega,
      firmaEncargadoMime: orden.firma_encargado_entrega_mime || "image/png",
      entregadoPor: entregadoPor?.nombre || "Usuario",
      notasEntrega: orden.notas_entrega,
      nombreEmpresa: org?.nombre,
      telefonoEmpresa: org?.telefono,
      direccionEmpresa: org?.direccion,
      logoUrl: org?.logo_url,
    })

    const codigoDisplay = orden.codigo_orden || `${orden.numero_orden}`

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="comprobante-entrega-${codigoDisplay}.pdf"`,
      },
    })
  } catch (error) {
    console.error("Error generating delivery receipt PDF:", error)
    return NextResponse.json({ error: "Error al generar comprobante" }, { status: 500 })
  }
}
