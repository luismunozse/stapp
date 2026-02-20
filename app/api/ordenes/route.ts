import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getNextOrderNumberByType } from "@/lib/counters"
import { createAuditLogger } from "@/lib/audit"
import { uploadOrderPhoto, base64ToBuffer } from "@/lib/storage"
import { enforcePlanLimit } from "@/lib/plan-limits"
import { z } from "zod"

// Generar token público único
function generatePublicToken(): string {
  return randomBytes(16).toString("hex")
}

const fotoSchema = z.object({
  data: z.string(),
  mime: z.string(),
  descripcion: z.string().optional(),
  tipo: z.string().default("INGRESO"),
})

const ordenSchema = z.object({
  clienteId: z.string().min(1, "El cliente es requerido"),
  dispositivo: z.string().min(1, "El dispositivo es requerido"),
  tipoDispositivo: z.string().min(1, "El tipo de dispositivo es requerido"),
  marca: z.string().optional(),
  color: z.string().optional(),
  imei: z.string().optional(),
  problemaReportado: z.string().min(1, "El problema es requerido"),
  accesorios: z.string().optional(),
  codigoAccesoDispositivo: z.string().optional(),
  presupuesto: z.number().optional(),
  fechaPrometida: z.string().optional(),
  observaciones: z.string().optional(),
  fotos: z.array(fotoSchema).optional(),
  // Nuevos campos para presupuesto aceptado
  presupuestoAceptado: z.boolean().optional(),
  sena: z.number().optional(),
})

export async function GET(request: Request) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado") || ""
    const tecnicoId = searchParams.get("tecnicoId") || ""
    const search = searchParams.get("search") || ""

    // Paginación
    const page = parseInt(searchParams.get("page") || "1")
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100) // Max 100
    const offset = (page - 1) * limit

    // Sorting
    const sortBy = searchParams.get("sortBy") || "fecha_ingreso"
    const sortOrder = searchParams.get("sortOrder") === "asc" ? true : false

    let query = supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        *,
        clientes (*),
        users:tecnico_id (
          id,
          nombre
        )
      `, { count: "exact" })
      .eq("organization_id", organizationId!)
      .order(sortBy === "fechaIngreso" ? "fecha_ingreso" : sortBy, { ascending: sortOrder })

    // Técnicos solo ven sus órdenes asignadas
    if (role === "TECNICO") {
      query = query.eq("tecnico_id", userId!)
    }

    if (estado) {
      query = query.eq("estado", estado)
    }

    if (tecnicoId) {
      query = query.eq("tecnico_id", tecnicoId)
    }

    if (search) {
      // Primero buscar IDs de clientes que coincidan con la búsqueda
      const { data: clientesMatch } = await supabaseAdmin
        .from("clientes")
        .select("id")
        .eq("organization_id", organizationId!)
        .or(`nombre.ilike.%${search}%,telefono.ilike.%${search}%`)

      const clienteIds = clientesMatch?.map(c => c.id) || []

      // Búsqueda en múltiples campos incluyendo clientes
      if (clienteIds.length > 0) {
        query = query.or(
          `dispositivo.ilike.%${search}%,numero_orden::text.ilike.%${search}%,codigo_orden.ilike.%${search}%,marca.ilike.%${search}%,cliente_id.in.(${clienteIds.join(",")})`
        )
      } else {
        query = query.or(
          `dispositivo.ilike.%${search}%,numero_orden::text.ilike.%${search}%,codigo_orden.ilike.%${search}%,marca.ilike.%${search}%`
        )
      }
    }

    // Aplicar paginación
    query = query.range(offset, offset + limit - 1)

    const { data: ordenes, error: dbError, count } = await query

    if (dbError) {
      throw dbError
    }

    // Transformar datos para mantener compatibilidad con el frontend
    const ordenesFormatted = ordenes?.map(orden => ({
      ...orden,
      cliente: orden.clientes,
      tecnico: orden.users,
      // Convertir snake_case a camelCase para compatibilidad
      numeroOrden: orden.numero_orden,
      codigoOrden: orden.codigo_orden,
      clienteId: orden.cliente_id,
      tecnicoId: orden.tecnico_id,
      organizationId: orden.organization_id,
      tipoDispositivo: orden.tipo_dispositivo,
      problemaReportado: orden.problema_reportado,
      costoFinal: orden.costo_final,
      fechaIngreso: orden.fecha_ingreso,
      fechaPrometida: orden.fecha_prometida,
      fechaCompletado: orden.fecha_completado,
      // Nuevos campos
      codigoAccesoDispositivo: orden.password_dispositivo,
    }))

    // Retornar con información de paginación y cache headers
    return NextResponse.json({
      data: ordenesFormatted,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    })
  } catch (error) {
    console.error("Error fetching ordenes:", error)
    return NextResponse.json(
      { error: "Error al obtener órdenes" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAuth()
    if (error) return error

    // Verificar límite de órdenes del plan
    const limitError = await enforcePlanLimit(organizationId!, "ordenes")
    if (limitError) return limitError

    const body = await request.json()
    const data = ordenSchema.parse(body)

    // Obtener siguiente número de orden con prefijo por tipo de dispositivo
    const { codigo: codigoOrden, numero: numeroOrden } = await getNextOrderNumberByType(
      organizationId!,
      data.tipoDispositivo
    )

    // Generar token público para acceso al PDF
    const publicToken = generatePublicToken()

    // Determinar estado inicial y costo final
    const estadoInicial = data.presupuestoAceptado ? "EN_REPARACION" : "RECIBIDO"
    const costoFinal = data.presupuestoAceptado && data.presupuesto ? data.presupuesto : null

    const { data: orden, error: dbError } = await supabaseAdmin
      .from("ordenes_servicio")
      .insert({
        numero_orden: numeroOrden,
        codigo_orden: codigoOrden,
        cliente_id: data.clienteId,
        organization_id: organizationId!,
        dispositivo: data.dispositivo,
        tipo_dispositivo: data.tipoDispositivo,
        marca: data.marca || null,
        color: data.color || null,
        imei: data.imei || null,
        problema_reportado: data.problemaReportado,
        accesorios: data.accesorios || null,
        password_dispositivo: data.codigoAccesoDispositivo || null,
        presupuesto: data.presupuesto || null,
        fecha_prometida: data.fechaPrometida
          ? new Date(data.fechaPrometida).toISOString()
          : null,
        observaciones: data.observaciones || null,
        public_token: publicToken,
        // Nuevos campos
        estado: estadoInicial,
        costo_final: costoFinal,
        sena: data.sena || 0,
      })
      .select(`
        *,
        clientes (*)
      `)
      .single()

    if (dbError) {
      throw dbError
    }

    // Subir fotos de ingreso si se proporcionaron
    if (data.fotos && data.fotos.length > 0) {
      for (const foto of data.fotos) {
        try {
          const buffer = base64ToBuffer(foto.data)
          const { url, path } = await uploadOrderPhoto(
            organizationId!,
            orden.id,
            buffer,
            foto.mime
          )

          // Guardar referencia en la base de datos
          await supabaseAdmin.from("fotos_orden").insert({
            orden_id: orden.id,
            url,
            storage_path: path,
            mime: foto.mime,
            size: buffer.length,
            descripcion: foto.descripcion || null,
            tipo: foto.tipo || "INGRESO",
          })
        } catch (fotoError) {
          console.error("Error uploading photo:", fotoError)
          // Continuar con las demás fotos aunque falle una
        }
      }
    }

    // Registrar en auditoría
    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.create("ordenes_servicio", orden.id, {
      numero_orden: orden.numero_orden,
      dispositivo: orden.dispositivo,
      cliente_id: orden.cliente_id,
      fotos_ingreso: data.fotos?.length || 0,
    })

    // Obtener nombre de la organización para el mensaje de WhatsApp
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("nombre, nombre_mostrar")
      .eq("id", organizationId!)
      .single()

    // Transformar para compatibilidad
    const ordenFormatted = {
      ...orden,
      cliente: orden.clientes,
      numeroOrden: orden.numero_orden,
      codigoOrden: orden.codigo_orden,
      clienteId: orden.cliente_id,
      organizationId: orden.organization_id,
      tipoDispositivo: orden.tipo_dispositivo,
      problemaReportado: orden.problema_reportado,
      fechaIngreso: orden.fecha_ingreso,
      fechaPrometida: orden.fecha_prometida,
      publicToken: orden.public_token,
      organizationName: org?.nombre_mostrar || org?.nombre || null,
    }

    return NextResponse.json(ordenFormatted, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating orden:", error)
    return NextResponse.json(
      { error: "Error al crear orden" },
      { status: 500 }
    )
  }
}
