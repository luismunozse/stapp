import { NextResponse } from "next/server"
import { generateOrdenPDF, OrdenPDFData } from "@/lib/pdf"
import { getOrderByPublicToken } from "@/lib/public-token"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    const { orden, error } = await getOrderByPublicToken(token, `
        *,
        clientes (*),
        organizations (
          id,
          nombre,
          nombre_mostrar,
          telefono,
          direccion,
          logo_url,
          moneda,
          zona_horaria
        ),
        users:entregado_por_user_id (
          nombre
        ),
        sectores_cliente (
          nombre
        )
      `)
    if (error) return error

    const cliente = orden.clientes as any
    const org = orden.organizations as any
    const entregadoPorUser = orden.users as any
    const sectorObj = orden.sectores_cliente as any

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
      tipoDispositivo: orden.tipo_dispositivo,
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
