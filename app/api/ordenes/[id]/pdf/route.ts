import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateOrdenPDF, OrdenPDFData } from "@/lib/pdf-orden"

export const runtime = "nodejs"

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
        clientes (*),
        organizations (
          id,
          nombre,
          nombre_mostrar,
          telefono,
          direccion,
          logo_url
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

    const cliente = orden.clientes as any
    const org = orden.organizations as any

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
      tipoDispositivo: safeString(orden.tipo_dispositivo) || "OTRO",
      marca: safeString(orden.marca),
      color: safeString(orden.color),
      imei: safeString(orden.imei),
      problemaReportado: safeString(orden.problema_reportado) || "Sin descripción",
      accesorios: safeString(orden.accesorios),
      passwordDispositivo: safeString(orden.password_dispositivo),
      presupuesto: typeof orden.presupuesto === "number" ? orden.presupuesto : null,
      observaciones: safeString(orden.observaciones),
      nombreEmpresa: safeString(org?.nombre_mostrar) || safeString(org?.nombre) || undefined,
      telefonoEmpresa: safeString(org?.telefono) || undefined,
      direccionEmpresa: safeString(org?.direccion) || undefined,
      logoUrl: safeString(org?.logo_url),
    }

    // Generar PDF con React-PDF
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
