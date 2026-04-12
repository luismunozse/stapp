import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getNextOrderNumberByType } from "@/lib/counters"
import { createAuditLogger } from "@/lib/audit"
import { uploadOrderPhoto, base64ToBuffer } from "@/lib/storage"
import { enforcePlanLimit } from "@/lib/plan-limits"
import { formatOrden } from "@/lib/db-utils"
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
  metodoPagoSena: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  sectorId: z.string().optional(),
  telefonoContacto: z.string().optional(),
})

export async function GET(request: Request) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado") || ""
    const tecnicoId = searchParams.get("tecnicoId") || ""
    const search = searchParams.get("search") || ""

    // Filtros adicionales
    const tipoDispositivo = searchParams.get("tipoDispositivo") || ""
    const marca = searchParams.get("marca") || ""
    const estadoCobro = searchParams.get("estadoCobro") || ""
    const conPresupuesto = searchParams.get("conPresupuesto") || ""
    const conSena = searchParams.get("conSena") || ""
    const sinTecnico = searchParams.get("sinTecnico") || ""
    const vencimiento = searchParams.get("vencimiento") || "" // "vencidas" | "venceHoy"

    // Paginación
    const page = parseInt(searchParams.get("page") || "1")
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100) // Max 100
    const offset = (page - 1) * limit

    // Fechas
    const fechaDesde = searchParams.get("fechaDesde") || ""
    const fechaHasta = searchParams.get("fechaHasta") || ""
    const fechaPrometidaDesde = searchParams.get("fechaPrometidaDesde") || ""
    const fechaPrometidaHasta = searchParams.get("fechaPrometidaHasta") || ""

    // Sorting (whitelist de columnas permitidas)
    const allowedSortColumns: Record<string, string> = {
      fechaIngreso: "fecha_ingreso",
      fecha_ingreso: "fecha_ingreso",
      fechaPrometida: "fecha_prometida",
      fecha_prometida: "fecha_prometida",
      numeroOrden: "numero_orden",
      numero_orden: "numero_orden",
      estado: "estado",
      dispositivo: "dispositivo",
      presupuesto: "presupuesto",
    }
    const rawSortBy = searchParams.get("sortBy") || "fecha_ingreso"
    const sortBy = allowedSortColumns[rawSortBy] || "fecha_ingreso"
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
      .order(sortBy, { ascending: sortOrder })

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

    if (fechaDesde) {
      query = query.gte("fecha_ingreso", `${fechaDesde}T00:00:00`)
    }

    if (fechaHasta) {
      query = query.lte("fecha_ingreso", `${fechaHasta}T23:59:59`)
    }

    if (fechaPrometidaDesde) {
      query = query.gte("fecha_prometida", `${fechaPrometidaDesde}T00:00:00`)
    }

    if (fechaPrometidaHasta) {
      query = query.lte("fecha_prometida", `${fechaPrometidaHasta}T23:59:59`)
    }

    if (tipoDispositivo) {
      query = query.eq("tipo_dispositivo", tipoDispositivo)
    }

    if (marca) {
      query = query.ilike("marca", `%${marca}%`)
    }

    if (estadoCobro) {
      query = query.eq("estado_cobro", estadoCobro)
    }

    if (conPresupuesto === "si") {
      query = query.not("presupuesto", "is", null).gt("presupuesto", 0)
    } else if (conPresupuesto === "no") {
      query = query.or("presupuesto.is.null,presupuesto.eq.0")
    }

    if (conSena === "si") {
      query = query.gt("sena", 0)
    } else if (conSena === "no") {
      query = query.or("sena.is.null,sena.eq.0")
    }

    if (sinTecnico === "true") {
      query = query.is("tecnico_id", null)
    }

    if (vencimiento === "vencidas") {
      const now = new Date().toISOString()
      query = query.lt("fecha_prometida", now)
        .not("estado", "in", "(ENTREGADO,ENTREGADO_SIN_REPARACION,CANCELADO,SIN_REPARACION)")
    } else if (vencimiento === "venceHoy") {
      const hoy = new Date()
      const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString()
      const finHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59).toISOString()
      query = query.gte("fecha_prometida", inicioHoy).lte("fecha_prometida", finHoy)
        .not("estado", "in", "(ENTREGADO,ENTREGADO_SIN_REPARACION,CANCELADO,SIN_REPARACION)")
    }

    if (search) {
      // Primero buscar IDs de clientes que coincidan con la búsqueda
      const { data: clientesMatch } = await supabaseAdmin
        .from("clientes")
        .select("id")
        .eq("organization_id", organizationId!)
        .or(`nombre.ilike.%${search}%,telefono.ilike.%${search}%`)

      const clienteIds = clientesMatch?.map(c => c.id) || []

      // Construir filtros de búsqueda (sin ::text que no es válido en PostgREST)
      const filters = [
        `dispositivo.ilike.%${search}%`,
        `codigo_orden.ilike.%${search}%`,
        `marca.ilike.%${search}%`,
      ]

      // Si el search es numérico, buscar por numero_orden exacto
      const searchNum = parseInt(search, 10)
      if (!isNaN(searchNum)) {
        filters.push(`numero_orden.eq.${searchNum}`)
      }

      if (clienteIds.length > 0) {
        filters.push(`cliente_id.in.(${clienteIds.join(",")})`)
      }

      query = query.or(filters.join(","))
    }

    // Aplicar paginación
    query = query.range(offset, offset + limit - 1)

    const { data: ordenes, error: dbError, count } = await query

    if (dbError) {
      throw dbError
    }

    // Transformar datos usando formatOrden unificado
    const ordenesFormatted = ordenes?.map(formatOrden)

    // Retornar con información de paginación y cache headers
    return NextResponse.json({
      data: ordenesFormatted,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
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
    const { error, organizationId, userId, role } = await requireAuth()
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
        metodo_pago_sena: data.metodoPagoSena || "EFECTIVO",
        metadata: data.metadata || {},
        sector_id: data.sectorId || null,
        tecnico_id: role === "TECNICO" ? userId : null,
        telefono_contacto: data.telefonoContacto || null,
      })
      .select(`
        *,
        clientes (*)
      `)
      .single()

    if (dbError) {
      throw dbError
    }

    // Si hay seña, crear cobro_orden y actualizar total_cobrado
    if (data.sena && data.sena > 0) {
      await supabaseAdmin.from("cobros_orden").insert({
        orden_id: orden.id,
        organization_id: organizationId!,
        monto: data.sena,
        metodo_pago: data.metodoPagoSena || "EFECTIVO",
        observaciones: "Seña al ingreso del equipo",
        usuario_id: userId!,
      })
      await supabaseAdmin.rpc("recalcular_estado_cobro", { p_orden_id: orden.id })
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
