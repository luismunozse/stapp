import { NextResponse } from "next/server"
import { getOrderByPublicToken } from "@/lib/public-token"
import { getDeviceTypeLabel } from "@/lib/device-types"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    const { orden, error } = await getOrderByPublicToken(token, `
        id,
        numero_orden,
        codigo_orden,
        dispositivo,
        tipo_dispositivo,
        marca,
        color,
        estado,
        fecha_ingreso,
        fecha_prometida,
        fecha_completado,
        fecha_entrega,
        accesorios,
        problema_reportado,
        public_token,
        tipos_dispositivo:tipo_dispositivo_id (
          nombre
        ),
        clientes (
          nombre
        ),
        organizations (
          id,
          nombre,
          nombre_mostrar,
          telefono,
          direccion,
          logo_url,
          zona_horaria
        )
      `)
    if (error) return error

    const org = orden.organizations as any
    const cliente = orden.clientes as any
    const tipoDisp = orden.tipos_dispositivo as any

    return NextResponse.json({
      numeroOrden: orden.numero_orden,
      codigoOrden: orden.codigo_orden,
      dispositivo: orden.dispositivo,
      tipoDispositivo: orden.tipo_dispositivo,
      tipoDispositivoNombre: getDeviceTypeLabel(orden.tipo_dispositivo, tipoDisp?.nombre),
      marca: orden.marca,
      color: orden.color,
      estado: orden.estado,
      problemaReportado: orden.problema_reportado,
      accesorios: orden.accesorios,
      fechaIngreso: orden.fecha_ingreso,
      fechaPrometida: orden.fecha_prometida,
      fechaCompletado: orden.fecha_completado,
      fechaEntrega: orden.fecha_entrega,
      publicToken: orden.public_token,
      cliente: {
        nombre: cliente?.nombre || null,
      },
      zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
      organizacion: {
        nombre: org?.nombre_mostrar || org?.nombre || null,
        telefono: org?.telefono || null,
        direccion: org?.direccion || null,
        logoUrl: org?.logo_url || null,
      },
    })
  } catch (error) {
    console.error("Error fetching public order:", error)
    return NextResponse.json(
      { error: "Error interno" },
      { status: 500 }
    )
  }
}
