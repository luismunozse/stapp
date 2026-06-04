import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getNextOrderNumberByType } from "@/lib/counters"
import { createAuditLogger } from "@/lib/audit"
import { uploadOrderPhoto, base64ToBuffer } from "@/lib/storage"
import { enforcePlanLimit, isPlanLimitError, planLimitErrorResponse } from "@/lib/plan-limits"
import { formatOrden } from "@/lib/db-utils"
import { sucursalParaEscritura, sucursalParaLectura } from "@/lib/sucursal"
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
  notasInternas: z.string().optional(),
  fotos: z.array(fotoSchema).optional(),
  // Nuevos campos para presupuesto aceptado
  presupuestoAceptado: z.boolean().optional(),
  sena: z.number().optional(),
  metodoPagoSena: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  sectorId: z.string().optional(),
  telefonoContacto: z.string().optional(),
  tecnicoId: z.string().optional(),
  // Origen: turno previo (visita on-site agendada). Si viene, al crear la orden
  // se vincula y el turno pasa a estado 'orden_generada' (trigger SQL).
  fromTurnoId: z.string().optional(),
})

export async function GET(request: Request) {
  try {
    const { error, session, organizationId, userId, role } = await requireAuth()
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

    // Filtro por sucursal (ADMIN ve según cookie; otros roles su sucursal fija)
    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })
    if (!filtro.verTodas && filtro.sucursalId) {
      query = query.eq("sucursal_id", filtro.sucursalId)
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
        `imei.ilike.%${search}%`,
      ]

      // Si el search es numérico y entra en rango INT32, buscar por numero_orden exacto.
      // Evita errores de PostgREST cuando se buscan IMEIs/seriales largos.
      const searchNum = parseInt(search, 10)
      if (!isNaN(searchNum) && searchNum >= 0 && searchNum <= 2147483647 && /^\d+$/.test(search)) {
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
    const { error, session, organizationId, userId, role } = await requireAuth()
    if (error) return error

    // Verificar límite de órdenes del plan
    const limitError = await enforcePlanLimit(organizationId!, "ordenes")
    if (limitError) return limitError

    const body = await request.json()
    const data = ordenSchema.parse(body)

    // Si la orden se origina en un turno: validar que pertenece a la org y que
    // todavía no fue vinculado a otra orden.
    let turnoOrigen: { id: string; tecnico_id: string | null } | null = null
    if (data.fromTurnoId) {
      const { data: turnoCheck } = await supabaseAdmin
        .from("turnos")
        .select("id, organization_id, orden_id, tecnico_id")
        .eq("id", data.fromTurnoId)
        .eq("organization_id", organizationId!)
        .maybeSingle()
      if (!turnoCheck) {
        return NextResponse.json({ error: "Turno origen no encontrado" }, { status: 400 })
      }
      if (turnoCheck.orden_id) {
        return NextResponse.json(
          { error: "Turno ya tiene orden generada" },
          { status: 400 },
        )
      }
      turnoOrigen = { id: turnoCheck.id, tecnico_id: turnoCheck.tecnico_id }
    }

    // Obtener siguiente número de orden con prefijo por tipo de dispositivo
    const { codigo: codigoOrden, numero: numeroOrden } = await getNextOrderNumberByType(
      organizationId!,
      data.tipoDispositivo
    )

    // Generar token público para acceso al PDF
    const publicToken = generatePublicToken()

    // Resolver técnico asignado: TECNICO → siempre él mismo; otros roles → optativo desde el form
    let tecnicoAsignadoId: string | null = role === "TECNICO" ? userId! : null
    if (role !== "TECNICO" && data.tecnicoId) {
      const { data: tecnicoCheck } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("id", data.tecnicoId)
        .eq("organization_id", organizationId!)
        .eq("rol", "TECNICO")
        .maybeSingle()
      if (!tecnicoCheck) {
        return NextResponse.json({ error: "Técnico inválido" }, { status: 400 })
      }
      tecnicoAsignadoId = data.tecnicoId
    }

    // Determinar estado inicial y costo final
    const estadoInicial = data.presupuestoAceptado ? "EN_REPARACION" : "RECIBIDO"
    const costoFinal = data.presupuestoAceptado && data.presupuesto ? data.presupuesto : null

    // Resolver sucursal concreta de escritura según rol/cookie/usuario
    const sucursalId = await sucursalParaEscritura({
      role,
      organizationId: organizationId!,
      userSucursalId: session!.user.sucursalId ?? null,
    })

    const { data: orden, error: dbError } = await supabaseAdmin
      .from("ordenes_servicio")
      .insert({
        numero_orden: numeroOrden,
        sucursal_id: sucursalId,
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
          ? new Date(`${data.fechaPrometida}T12:00:00Z`).toISOString()
          : null,
        observaciones: data.observaciones || null,
        notas_internas: data.notasInternas || null,
        public_token: publicToken,
        // Nuevos campos
        estado: estadoInicial,
        costo_final: costoFinal,
        sena: data.sena || 0,
        metodo_pago_sena: data.metodoPagoSena || "EFECTIVO",
        metadata: data.metadata || {},
        sector_id: data.sectorId || null,
        tecnico_id: tecnicoAsignadoId,
        telefono_contacto: data.telefonoContacto || null,
      })
      .select(`
        *,
        clientes (*)
      `)
      .single()

    if (dbError) {
      // El trigger update_ordenes_count rollbackea el INSERT si se excede el
      // limite del plan (race condition que el pre-check TS no atrapa).
      if (isPlanLimitError(dbError)) {
        return planLimitErrorResponse(dbError)
      }
      throw dbError
    }

    // Vincular turno origen (trigger SQL sincroniza estado a 'orden_generada')
    if (turnoOrigen) {
      const { error: linkError } = await supabaseAdmin
        .from("turnos")
        .update({ orden_id: orden.id })
        .eq("id", turnoOrigen.id)
        .eq("organization_id", organizationId!)
      if (linkError) {
        console.error("Error linking turno to orden:", linkError)
      }
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

    // Obtener datos de la organización para el mensaje de WhatsApp y comprobante térmico
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("nombre, nombre_mostrar, logo_url, telefono, direccion, comprobante_terminos")
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
      costoFinal: orden.costo_final,
      telefonoContacto: orden.telefono_contacto,
      publicToken: orden.public_token,
      organizationName: org?.nombre_mostrar || org?.nombre || null,
      organizationLogoUrl: org?.logo_url ?? null,
      organizationTelefono: org?.telefono ?? null,
      organizationDireccion: org?.direccion ?? null,
      organizationComprobanteTerminos: org?.comprobante_terminos ?? null,
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
