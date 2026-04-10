import { NextResponse } from "next/server"
import { generateOrdenPDF, OrdenPDFData } from "@/lib/pdf"
import { getOrderByPublicToken } from "@/lib/public-token"
import { getDeviceTypeLabel } from "@/lib/device-types"
import { supabaseAdmin } from "@/lib/supabase"
import { headers } from "next/headers"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    const { orden, error } = await getOrderByPublicToken(token, `
        *,
        tipos_dispositivo:tipo_dispositivo_id(nombre),
        clientes (*),
        organizations (*),
        users:entregado_por_user_id (
          nombre
        ),
        sectores_cliente (
          nombre
        )
      `)
    if (error) return error

    // Fetch checklist data
    const { data: checklistData } = await supabaseAdmin
      .from("checklist_recepcion")
      .select(`
        valores, notas, firma_cliente, firma_mime,
        checklist_templates (
          checklist_template_items (id, label, orden)
        )
      `)
      .eq("orden_id", orden.id)
      .maybeSingle()

    // Fetch intake photos
    const { data: fotosData } = await supabaseAdmin
      .from("fotos_orden")
      .select("url, descripcion")
      .eq("orden_id", orden.id)
      .eq("tipo", "INGRESO")
      .order("created_at", { ascending: true })
      .limit(4)

    // Build base URL for QR
    const headersList = await headers()
    const host = headersList.get("host") || "localhost:3000"
    const proto = headersList.get("x-forwarded-proto") || "https"
    const baseUrl = `${proto}://${host}`

    const cliente = orden.clientes as any
    const org = orden.organizations as any
    const entregadoPorUser = orden.users as any
    const sectorObj = orden.sectores_cliente as any
    const tipoDisp = orden.tipos_dispositivo as any

    // Build checklist items with labels
    let checklistItems: Array<{ label: string; valor: boolean | string | null }> | null = null
    if (checklistData?.checklist_templates) {
      const templateItems = (checklistData.checklist_templates as any).checklist_template_items || []
      const valores = typeof checklistData.valores === "string"
        ? JSON.parse(checklistData.valores)
        : checklistData.valores || {}
      const sortedItems = [...templateItems].sort((a: any, b: any) => (a.orden || 0) - (b.orden || 0))
      checklistItems = sortedItems.map((item: any) => ({
        label: item.label,
        valor: valores[item.id] ?? null,
      })).filter((item: any) => item.valor !== null && item.valor !== undefined)
    }

    // Preparar datos para el PDF
    const pdfData: OrdenPDFData = {
      numeroOrden: orden.numero_orden,
      fechaIngreso: new Date(orden.fecha_ingreso),
      fechaPrometida: orden.fecha_prometida ? new Date(orden.fecha_prometida) : null,
      cliente: {
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        email: cliente.email,
        direccion: cliente.direccion,
      },
      dispositivo: orden.dispositivo,
      tipoDispositivo: getDeviceTypeLabel(orden.tipo_dispositivo, tipoDisp?.nombre),
      marca: orden.marca,
      color: orden.color,
      imei: orden.imei,
      problemaReportado: orden.problema_reportado,
      accesorios: orden.accesorios,
      codigoAccesoDispositivo: orden.password_dispositivo,
      presupuesto: orden.presupuesto,
      observaciones: orden.observaciones,
      nombreEmpresa: org?.nombre_mostrar || org?.nombre,
      telefonoEmpresa: org?.telefono,
      direccionEmpresa: org?.direccion,
      ciudadEmpresa: org?.ciudad,
      provinciaEmpresa: org?.provincia,
      codigoPostalEmpresa: org?.codigo_postal,
      logoUrl: org?.logo_url,
      moneda: org?.moneda || "ARS",
      zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
      estado: orden.estado,
      fechaEntrega: orden.fecha_entrega ? new Date(orden.fecha_entrega) : null,
      firmaClienteEntrega: orden.firma_cliente_entrega,
      firmaClienteEntregaMime: orden.firma_cliente_entrega_mime,
      firmaEncargadoEntrega: orden.firma_encargado_entrega,
      firmaEncargadoEntregaMime: orden.firma_encargado_entrega_mime,
      entregadoPor: entregadoPorUser?.nombre || null,
      notasEntrega: orden.notas_entrega,
      sector: sectorObj?.nombre || null,
      recepcionTerminos: org?.recepcion_terminos || undefined,
      publicToken: orden.public_token,
      baseUrl,
      sena: typeof orden.sena === "number" && orden.sena > 0 ? orden.sena : null,
      metodoPagoSena: orden.metodo_pago_sena,
      checklistItems,
      checklistNotas: checklistData?.notas || null,
      firmaRecepcion: checklistData?.firma_cliente || null,
      firmaRecepcionMime: checklistData?.firma_mime || null,
      fotosIngreso: fotosData && fotosData.length > 0 ? fotosData : null,
      soloCliente: true,
    }

    // Generar PDF
    const pdfBuffer = await generateOrdenPDF(pdfData)

    // Retornar PDF (convertir Buffer a Uint8Array)
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="orden-${orden.numero_orden}.pdf"`,
      },
    })
  } catch (error) {
    console.error("Error generating public orden PDF:", error)
    return NextResponse.json(
      { error: "Error al generar PDF" },
      { status: 500 }
    )
  }
}
