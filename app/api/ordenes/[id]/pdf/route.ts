import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateOrdenPDF, OrdenPDFData } from "@/lib/pdf"
import { getDeviceTypeLabel } from "@/lib/device-types"
import { headers } from "next/headers"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { id } = await params

    // Obtener la orden con datos del cliente y organización
    const { data: orden, error: dbError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        *,
        tipos_dispositivo:tipo_dispositivo_id(nombre),
        clientes (*),
        organizations (
          id,
          nombre,
          nombre_mostrar,
          telefono,
          direccion,
          logo_url,
          moneda,
          zona_horaria,
          recepcion_terminos
        ),
        users:entregado_por_user_id (
          nombre
        ),
        sectores_cliente (
          nombre
        )
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (dbError || !orden) {
      return NextResponse.json(
        { error: "Orden no encontrada" },
        { status: 404 }
      )
    }

    // Técnicos solo pueden ver PDF de sus órdenes asignadas
    if (role === "TECNICO" && orden.tecnico_id !== userId) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 403 }
      )
    }

    // Fetch checklist data
    const { data: checklistData } = await supabaseAdmin
      .from("checklist_recepcion")
      .select(`
        valores, notas, firma_cliente, firma_mime,
        checklist_templates (
          checklist_template_items (label, orden)
        )
      `)
      .eq("orden_id", id)
      .single()

    // Fetch intake photos
    const { data: fotosData } = await supabaseAdmin
      .from("fotos_orden")
      .select("url, descripcion")
      .eq("orden_id", id)
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

    // Helper to ensure we only pass primitive values
    const safeString = (val: unknown): string | null => {
      if (val === null || val === undefined) return null
      if (typeof val === "string") return val
      if (typeof val === "number") return String(val)
      if (typeof val === "boolean") return val ? "Si" : "No"
      // For objects, try to stringify or return null
      if (typeof val === "object") {
        try {
          return JSON.stringify(val)
        } catch {
          return null
        }
      }
      return String(val)
    }

    // Preparar datos para el PDF - ensuring all values are primitives
    const pdfData: OrdenPDFData = {
      numeroOrden: orden.numero_orden,
      fechaIngreso: new Date(orden.fecha_ingreso),
      fechaPrometida: orden.fecha_prometida ? new Date(orden.fecha_prometida) : null,
      cliente: {
        nombre: safeString(cliente?.nombre) || "Sin nombre",
        telefono: safeString(cliente?.telefono) || "Sin teléfono",
        email: safeString(cliente?.email),
        direccion: safeString(cliente?.direccion),
      },
      dispositivo: safeString(orden.dispositivo) || "Sin especificar",
      tipoDispositivo: getDeviceTypeLabel(safeString(orden.tipo_dispositivo) || "OTRO", tipoDisp?.nombre),
      marca: safeString(orden.marca),
      color: safeString(orden.color),
      imei: safeString(orden.imei),
      problemaReportado: safeString(orden.problema_reportado) || "Sin descripción",
      accesorios: safeString(orden.accesorios),
      codigoAccesoDispositivo: safeString(orden.password_dispositivo),
      presupuesto: typeof orden.presupuesto === "number" ? orden.presupuesto : null,
      observaciones: safeString(orden.observaciones),
      nombreEmpresa: safeString(org?.nombre_mostrar) || safeString(org?.nombre) || undefined,
      telefonoEmpresa: safeString(org?.telefono) || undefined,
      direccionEmpresa: safeString(org?.direccion) || undefined,
      logoUrl: safeString(org?.logo_url),
      moneda: safeString(org?.moneda) || "ARS",
      zonaHoraria: safeString(org?.zona_horaria) || "America/Argentina/Buenos_Aires",
      estado: safeString(orden.estado) || undefined,
      fechaEntrega: orden.fecha_entrega ? new Date(orden.fecha_entrega) : null,
      firmaClienteEntrega: safeString(orden.firma_cliente_entrega),
      firmaClienteEntregaMime: safeString(orden.firma_cliente_entrega_mime),
      firmaEncargadoEntrega: safeString(orden.firma_encargado_entrega),
      firmaEncargadoEntregaMime: safeString(orden.firma_encargado_entrega_mime),
      entregadoPor: safeString(entregadoPorUser?.nombre),
      notasEntrega: safeString(orden.notas_entrega),
      sector: safeString(sectorObj?.nombre),
      recepcionTerminos: safeString(org?.recepcion_terminos) || undefined,
      publicToken: safeString(orden.public_token),
      baseUrl,
      sena: typeof orden.sena === "number" && orden.sena > 0 ? orden.sena : null,
      metodoPagoSena: safeString(orden.metodo_pago_sena),
      checklistItems,
      checklistNotas: checklistData?.notas || null,
      firmaRecepcion: checklistData?.firma_cliente || null,
      firmaRecepcionMime: checklistData?.firma_mime || null,
      fotosIngreso: fotosData && fotosData.length > 0 ? fotosData : null,
    }

    // Generar PDF
    const pdfBuffer = await generateOrdenPDF(pdfData)

    // Retornar PDF como descarga (convertir Buffer a Uint8Array)
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="orden-${orden.numero_orden}.pdf"`,
      },
    })
  } catch (error) {
    console.error("Error generating orden PDF:", error)
    return NextResponse.json(
      { error: "Error al generar PDF" },
      { status: 500 }
    )
  }
}
