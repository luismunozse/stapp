import { NextResponse } from "next/server"
import { requirePosAccess, soloVeSusVentas } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"
import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
import { formatVenta } from "@/lib/db-utils"
import { sucursalParaLectura, resolverDestinoVenta, getNombreSucursal } from "@/lib/sucursal"
import { getRecargosMetodo, factorRecargo, metodoCondicion } from "@/lib/recargos"
import { resolveOperador } from "@/lib/operadores"
import { z } from "zod"
import { getIvaGeneral } from "@/lib/countries"

const itemSchema = z.object({
  inventarioId: z.string().nullable().optional(),
  descripcion: z.string().min(1, "La descripción es requerida"),
  cantidad: z.number().int().positive("La cantidad debe ser mayor a 0"),
  precioUnitario: z.number().positive("El precio debe ser mayor a 0"),
  diasGarantia: z.number().int().min(0).default(0),
  descuento: z.number().min(0).default(0),
  tipoDescuento: z.enum(["MONTO", "PORCENTAJE"]).default("MONTO"),
  porcentajeDescuento: z.number().min(0).max(100).default(0),
  serieIds: z.array(z.string()).optional(),
  costo: z.number().min(0).nullable().optional(),
})

const ventaSchema = z.object({
  clienteId: z.string().nullable().optional(),
  clienteNombre: z.string().min(1, "El nombre del cliente es requerido"),
  clienteTelefono: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1, "Debe agregar al menos un item"),
  descuento: z.number().min(0).default(0),
  tipoDescuento: z.enum(["MONTO", "PORCENTAJE"]).default("MONTO"),
  porcentajeDescuento: z.number().min(0).max(100).default(0),
  metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADOPAGO", "CUENTA_CORRIENTE", "OTRO"]),
  observaciones: z.string().nullable().optional(),
  cuotas: z.number().int().min(1).nullable().optional(),
  recargoPorcentaje: z.number().min(0).nullable().optional(),
  montoOriginal: z.number().positive().nullable().optional(),
  numeroReferencia: z.string().nullable().optional(),
  descuentoMotivo: z.string().nullable().optional(),
  pagosParcial: z.boolean().optional(),
  idempotencyKey: z.string().max(100).nullable().optional(),
  depositoId: z.string().min(1).nullable().optional(),
  pagos: z.array(z.object({
    metodo: z.string(),
    monto: z.number().positive(),
    referencia: z.string().nullable().optional(),
    cuotas: z.number().int().min(1).nullable().optional(),
    recargo: z.number().min(0).nullable().optional(),
    montoOriginal: z.number().positive().nullable().optional(),
    costoFinanciero: z.number().min(0).nullable().optional(),
  })).optional(),
  vendedorId: z.string().nullable().optional(),
})

export async function GET(request: Request) {
  try {
    const { error, organizationId, userId, role, session } = await requirePosAccess()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado") || ""
    const search = searchParams.get("search") || ""
    const fechaDesde = searchParams.get("fechaDesde") || ""
    const fechaHasta = searchParams.get("fechaHasta") || ""

    // Paginación
    const page = parseInt(searchParams.get("page") || "1")
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100)
    const offset = (page - 1) * limit

    // Sorting
    const sortByParam = searchParams.get("sortBy") || "createdAt"
    const sortMap: Record<string, string> = {
      createdAt: "created_at",
      numeroVenta: "numero_venta",
      clienteNombre: "cliente_nombre",
      total: "total",
    }
    const sortBy = sortMap[sortByParam] || "created_at"
    const sortOrder = searchParams.get("sortOrder") === "asc"

    let query = supabaseAdmin
      .from("ventas")
      .select(`
        *,
        clientes (*),
        users:vendedor_id (
          id,
          nombre
        ),
        items_venta (
          *,
          inventario (*)
        ),
        garantias_venta (*),
        pagos_venta (*),
        devoluciones_venta (*, items_devolucion(*))
      `, { count: "exact" })
      .eq("organization_id", organizationId!)
      .order(sortBy, { ascending: sortOrder })

    // Vendedores solo ven sus ventas
    if (soloVeSusVentas(role)) {
      query = query.eq("vendedor_id", userId!)
    }

    // Filtro por sucursal (no-ADMIN: su sucursal fija; ADMIN: según cookie)
    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })
    if (!filtro.verTodas && filtro.sucursalId) {
      query = query.eq("sucursal_id", filtro.sucursalId)
    }

    if (estado) {
      query = query.eq("estado", estado)
    }

    if (fechaDesde) {
      query = query.gte("created_at", fechaDesde)
    }

    if (fechaHasta) {
      query = query.lte("created_at", fechaHasta + "T23:59:59")
    }

    if (search) {
      const filters = [
        `cliente_nombre.ilike.%${search}%`,
        `cliente_telefono.ilike.%${search}%`,
        `observaciones.ilike.%${search}%`,
      ]

      // Si es numérico, buscar por numero_venta exacto
      const searchNum = parseInt(search, 10)
      if (!isNaN(searchNum)) {
        filters.push(`numero_venta.eq.${searchNum}`)
      }

      query = query.or(filters.join(","))
    }

    // Aplicar paginación
    query = query.range(offset, offset + limit - 1)

    const { data: ventas, error: dbError, count } = await query

    if (dbError) {
      throw dbError
    }

    // Transformar datos para el frontend
    const ventasFormatted = ventas?.map(formatVenta) || []

    return NextResponse.json({
      data: ventasFormatted,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    })
  } catch (error) {
    console.error("Error fetching ventas:", error)
    return NextResponse.json(
      { error: "Error al obtener ventas" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId, role, session, tecnicosOperanPos } = await requirePosAccess()
    if (error) return error

    const body = await request.json()
    const data = ventaSchema.parse(body)

    // Precio efectivo por método de pago: el método-condición (pago de mayor monto)
    // fija un factor que sube el precio de venta (ingreso real, no recargo bancario).
    const recargosMetodo = await getRecargosMetodo(organizationId!)
    const condicion = metodoCondicion(data.pagos, data.metodoPago)
    const factor = factorRecargo(recargosMetodo, condicion)

    // Calcular totales. Convención: venta.subtotal = bruto (Σ cantidad×precio);
    // venta.descuento = descuento total (por línea + global); venta.total =
    // bruto − descuento. Los descuentos por línea se restan del neto sobre el
    // que se aplica el descuento global (% global sobre el neto post-línea).
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

    let subtotalBruto = 0
    let descuentoItems = 0
    for (const item of data.items) {
      const precioEfectivo = round2(item.precioUnitario * factor)
      const lineaBruto = item.cantidad * precioEfectivo
      subtotalBruto += lineaBruto
      const lineaDesc =
        item.tipoDescuento === "PORCENTAJE"
          ? lineaBruto * (item.porcentajeDescuento / 100)
          : Math.min(item.descuento, lineaBruto)
      descuentoItems += lineaDesc
    }
    const subtotalNeto = subtotalBruto - descuentoItems

    let descuentoGlobal = data.descuento
    if (data.tipoDescuento === "PORCENTAJE") {
      descuentoGlobal = subtotalNeto * (data.porcentajeDescuento / 100)
    }
    // Clamp: el descuento global no puede exceder el neto (total nunca negativo)
    descuentoGlobal = Math.min(Math.max(descuentoGlobal, 0), subtotalNeto)

    const subtotal = round2(subtotalBruto)
    const descuentoMonto = round2(descuentoItems + descuentoGlobal)
    const base = round2(Math.max(subtotalBruto - descuentoItems - descuentoGlobal, 0))

    // Config fiscal de la organización (IVA + redondeo). select("*") es defensivo:
    // si las columnas no existen aún (migración 229 sin aplicar) quedan undefined
    // → régimen EXENTO, sin cambio de comportamiento (sin hazard de orden de deploy).
    const { data: orgFiscal } = await supabaseAdmin
      .from("organizations")
      .select("*")
      .eq("id", organizationId!)
      .single()
    const ivaRegimen: string = orgFiscal?.iva_regimen ?? "EXENTO"
    // iva_tasa en NULL significa "sin tasa propia: usar la del pais"
    // (migracion 310). Con regimen EXENTO no se aplica ninguna igual.
    const ivaTasa = Number(orgFiscal?.iva_tasa ?? getIvaGeneral(orgFiscal?.pais))
    const redondeoUnidad = Number(orgFiscal?.redondeo_efectivo ?? 0)

    // ¿Pago 100% en efectivo? (para redondeo)
    const isCash =
      data.pagos && data.pagos.length > 0
        ? data.pagos.every((p) => p.metodo === "EFECTIVO")
        : data.metodoPago === "EFECTIVO"

    // IVA por régimen (espeja computeVentaTotals del front)
    let ivaNeto = base
    let ivaMonto = 0
    let totalConIva = base
    if (ivaRegimen === "INCLUIDO" && ivaTasa > 0) {
      ivaNeto = round2(base / (1 + ivaTasa / 100))
      ivaMonto = round2(base - ivaNeto)
      totalConIva = base
    } else if (ivaRegimen === "ADITIVO" && ivaTasa > 0) {
      ivaNeto = base
      ivaMonto = round2(base * (ivaTasa / 100))
      totalConIva = round2(base + ivaMonto)
    }

    // Redondeo de efectivo
    let redondeoMonto = 0
    let total = totalConIva
    if (isCash && redondeoUnidad > 0) {
      const r = Math.round(totalConIva / redondeoUnidad) * redondeoUnidad
      redondeoMonto = round2(r - totalConIva)
      total = round2(r)
    }
    const fiscalActivo = ivaRegimen !== "EXENTO" || redondeoMonto !== 0

    // Preparar items para la función atómica. El precioUnitario se persiste con
    // el factor del método aplicado (precio efectivo = ingreso real).
    const pItems = data.items.map(item => ({
      inventarioId: item.inventarioId || null,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precioUnitario: round2(item.precioUnitario * factor),
      diasGarantia: item.diasGarantia,
      descuento: item.descuento,
      tipoDescuento: item.tipoDescuento,
      porcentajeDescuento: item.porcentajeDescuento,
      ...(item.serieIds && item.serieIds.length > 0 && { serieIds: item.serieIds }),
      ...(item.costo != null && { costo: item.costo }),
    }))

    // Resolver sucursal + deposito concretos para la escritura (no-ADMIN: la
    // suya; ADMIN: según cookie, fallback a principal). Mismo helper que usan
    // los endpoints de lectura del POS (scope=venta) para que nunca diverjan
    // sobre qué depósito descuenta la venta.
    const destinoVenta = await resolverDestinoVenta({
      role,
      organizationId: organizationId!,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    const sucursalId = destinoVenta.sucursalId
    const resolvedDepositoId = destinoVenta.depositoId

    // Resolver vendedor (server-authoritative: valida que pertenezca a la org con rol válido)
    // Quién puede quedar ACREDITADO como operador de la venta. Con el permiso
    // prendido el técnico también: si no está en la lista, resolveOperador lo
    // descarta en silencio y cae al fallback, y la venta que hizo el técnico
    // termina atribuida a otro.
    const vendedorId = await resolveOperador(
      organizationId!,
      data.vendedorId,
      userId!,
      { roles: tecnicosOperanPos ? ["VENDEDOR", "ADMIN", "TECNICO"] : ["VENDEDOR", "ADMIN"] }
    )

    // Crear venta atómicamente
    const rpcParams: Record<string, any> = {
      p_org_id: organizationId!,
      p_vendedor_id: vendedorId,
      p_cliente_id: data.clienteId || null,
      p_cliente_nombre: data.clienteNombre,
      p_cliente_telefono: data.clienteTelefono || null,
      p_subtotal: subtotal,
      p_descuento: descuentoMonto,
      p_tipo_descuento: data.tipoDescuento,
      p_porcentaje_descuento: data.porcentajeDescuento,
      p_total: total,
      p_metodo_pago: data.metodoPago,
      p_observaciones: data.observaciones || null,
      p_numero_referencia: data.numeroReferencia || null,
      p_cuotas: data.cuotas || null,
      p_recargo_porcentaje: data.recargoPorcentaje || null,
      p_monto_original: data.montoOriginal || null,
      p_items: pItems,
      p_idempotency_key: data.idempotencyKey || null,
      p_deposito_id: resolvedDepositoId,
      p_sucursal_id: sucursalId,
    }

    // Pass multi-payment array if provided
    if (data.pagos && data.pagos.length > 0) {
      rpcParams.p_pagos = data.pagos
    } else if (data.pagosParcial) {
      // Deferred payment ("paga después"): send empty array
      // RPC distinguishes NULL (legacy full payment) vs empty array (no payments)
      rpcParams.p_pagos = []
    }

    // Validate: a sale with pending balance requires a cliente_id
    const montoPagado = data.pagos && data.pagos.length > 0
      ? data.pagos.reduce((sum, p) => sum + p.monto, 0)
      : data.pagosParcial ? 0 : total
    const saldoPendiente = total - montoPagado
    if (saldoPendiente > 0 && !data.clienteId) {
      return NextResponse.json(
        { error: "Para una venta a cuenta corriente (sin cobro total) tenés que seleccionar un cliente." },
        { status: 400 }
      )
    }

    // Server-side payment/total reconciliation — mirrors the client guard in PosCheckoutDialog.
    // For non-partial sales: pagos must sum to exactly the effective total (tolerance 0.01).
    if (data.pagos && data.pagos.length > 0 && !data.pagosParcial) {
      if (Math.abs(saldoPendiente) > 0.01) {
        return NextResponse.json(
          { error: "El total de pagos no coincide con el total de la venta." },
          { status: 400 }
        )
      }
    }
    // For partial sales: pagos must not exceed the total.
    if (data.pagosParcial && montoPagado > total + 0.01) {
      return NextResponse.json(
        { error: "El total de pagos no puede exceder el total de la venta." },
        { status: 400 }
      )
    }

    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc("crear_venta_atomica", rpcParams)

    if (rpcError) {
      // 23505: violación del índice único de idempotencia → la venta ya existe.
      // Reintento idempotente: devolver la venta original sin duplicar.
      if ((rpcError as any).code === "23505" && data.idempotencyKey) {
        const { data: existente } = await supabaseAdmin
          .from("ventas")
          .select(`
            *,
            clientes (*),
            users:vendedor_id (id, nombre),
            items_venta (*, inventario (*)),
            garantias_venta (*),
            pagos_venta (*),
            devoluciones_venta (*, items_devolucion(*))
          `)
          .eq("organization_id", organizationId!)
          .eq("idempotency_key", data.idempotencyKey)
          .maybeSingle()

        if (existente) {
          const { data: org } = await supabaseAdmin
            .from("organizations")
            .select("nombre, nombre_mostrar")
            .eq("id", organizationId!)
            .single()
          return NextResponse.json({
            ...formatVenta(existente),
            organizationName: org?.nombre_mostrar || org?.nombre || null,
          }, { status: 201 })
        }

        // 23505 de idempotencia pero la venta original aún no es visible
        // (carrera de commit). No es un error del usuario; pedir reintento.
        return NextResponse.json(
          { error: "La venta ya se está registrando (reintento en curso). Volvé a intentar en unos segundos." },
          { status: 409 }
        )
      }

      // Mapped deposit error codes
      if (rpcError.code === "P0010") {
        // El nombre solo se necesita acá: resolverlo de forma diferida evita
        // una query extra en cada venta exitosa.
        //
        // Solo se nombra la sucursal cuando la venta salió de SU depósito. Sin
        // depositoId resuelto el RPC corrió con p_deposito_id = null y drenó de
        // toda la organización: el faltante es org-wide y esa sucursal no tiene
        // depósito principal, así que nombrarla sería falso (mismo criterio que
        // el indicador "Vendiendo desde", ver derivarLecturaVenta).
        const sucursalNombre =
          sucursalId && resolvedDepositoId
            ? await getNombreSucursal(organizationId!, sucursalId)
            : null
        return NextResponse.json(
          {
            error: sucursalNombre
              ? `Stock insuficiente en el depósito de ${sucursalNombre}`
              : "Stock insuficiente en el depósito seleccionado",
          },
          { status: 400 }
        )
      }
      if (rpcError.code === "P0011") {
        return NextResponse.json(
          { error: "La organización no tiene depósito principal configurado" },
          { status: 400 }
        )
      }

      // Los errores de RAISE EXCEPTION vienen en error.message
      console.error("Error en crear_venta_atomica:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Error al crear venta" },
        { status: 400 }
      )
    }

    const ventaId = rpcResult?.ventaId || rpcResult

    // Snapshot fiscal en la venta (solo si el régimen está activo o hubo
    // redondeo). Las columnas existen porque fiscalActivo ⇒ la org configuró
    // IVA/redondeo ⇒ migración 229 aplicada (sin hazard de orden de deploy).
    if (ventaId && fiscalActivo) {
      const { error: ivaError } = await supabaseAdmin
        .from("ventas")
        .update({
          iva_neto: ivaNeto,
          iva_monto: ivaMonto,
          iva_tasa: ivaTasa,
          iva_regimen: ivaRegimen,
          redondeo_monto: redondeoMonto,
        })
        .eq("id", ventaId)
      if (ivaError) {
        console.error("Error al guardar snapshot IVA:", ivaError)
        return NextResponse.json(
          { error: "Error al guardar datos fiscales de la venta" },
          { status: 500 }
        )
      }
    }

    // Registrar aprobación de descuento si aplica
    if (descuentoMonto > 0) {
      const { error: descuentoError } = await supabaseAdmin
        .from("ventas")
        .update({
          descuento_aprobado_por: userId!,
          descuento_motivo: data.descuentoMotivo || null,
        })
        .eq("id", ventaId)
      if (descuentoError) {
        console.error("Error al guardar atribución de descuento:", descuentoError)
        // Non-fatal: log but continue
      }
    }

    // Obtener venta completa con relaciones
    const { data: ventaCompleta } = await supabaseAdmin
      .from("ventas")
      .select(`
        *,
        clientes (*),
        users:vendedor_id (id, nombre),
        items_venta (*, inventario (*)),
        garantias_venta (*),
        pagos_venta (*),
        devoluciones_venta (*, items_devolucion(*))
      `)
      .eq("id", ventaId)
      .single()

    // Registrar en auditoría
    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.create("ventas", ventaId, {
      numero_venta: ventaCompleta?.numero_venta,
      total: ventaCompleta?.total,
      items: data.items.length,
    })

    // Obtener nombre de la organización para el mensaje de WhatsApp
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("nombre, nombre_mostrar")
      .eq("id", organizationId!)
      .single()

    // Webhook outbound: venta.completada (fire-and-forget)
    emitWebhookEvent(organizationId!, "venta.completada", {
      id: ventaId,
      numeroVenta: ventaCompleta?.numero_venta ?? null,
      clienteNombre: data.clienteNombre,
      total,
      metodoPago: data.metodoPago,
      items: data.items.length,
    }).catch(() => {})

    // Formatear respuesta
    const response = {
      ...formatVenta(ventaCompleta),
      organizationName: org?.nombre_mostrar || org?.nombre || null,
    }

    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.errors[0]
      const field = firstError.path.join(".")
      const message = field ? `${field}: ${firstError.message}` : firstError.message
      console.error("Zod validation errors:", JSON.stringify(error.errors, null, 2))
      return NextResponse.json(
        { error: message },
        { status: 400 }
      )
    }
    console.error("Error creating venta:", error)
    return NextResponse.json(
      { error: "Error al crear venta" },
      { status: 500 }
    )
  }
}
