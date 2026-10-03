import { NextResponse } from "next/server"
import { requirePosAccess, soloVeSusVentas } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"
import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
import { formatVenta } from "@/lib/db-utils"
import { sucursalParaLectura, resolverDestinoVenta, getNombreSucursal } from "@/lib/sucursal"
import { getRecargosMetodo } from "@/lib/recargos"
import {
  calcularTotalesVenta,
  conciliarPagos,
  condicionDeCobro,
  lineaConRecargo,
  type DescuentoConfig,
  type FiscalConfig,
  type IvaRegimen,
} from "@/lib/ventas/totales"
import { resolveOperador } from "@/lib/operadores"
import { z } from "zod"
import { getIvaGeneral } from "@/lib/countries"
import { escapeOrIlikeTerm } from "@/lib/pg-search"
import { DEFAULT_TIMEZONE, dayRangeUtc } from "@/lib/timezone"

const METODOS_PAGO = [
  "EFECTIVO", "TRANSFERENCIA", "TARJETA", "TARJETA_DEBITO", "TARJETA_CREDITO",
  "MERCADOPAGO", "CUENTA_CORRIENTE", "OTRO",
] as const

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
  metodoPago: z.enum(METODOS_PAGO),
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
    // Antes z.string(): un método inexistente llegaba al SQL y fallaba el cast
    // al enum con un 400 críptico.
    metodo: z.enum(METODOS_PAGO),
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

    // Fechas: días de la organización. "hasta" + "T23:59:59" sin offset se
    // leía como UTC y en Argentina dejaba afuera las ventas de 21 a 24 h.
    if (fechaDesde || fechaHasta) {
      const { data: org } = await supabaseAdmin
        .from("organizations")
        .select("zona_horaria")
        .eq("id", organizationId!)
        .single()
      const tz: string = org?.zona_horaria || DEFAULT_TIMEZONE
      const esDia = (f: string) => /^\d{4}-\d{2}-\d{2}$/.test(f)
      if (fechaDesde) {
        query = query.gte("created_at", esDia(fechaDesde) ? dayRangeUtc(fechaDesde, tz).desde : fechaDesde)
      }
      if (fechaHasta) {
        query = query.lte("created_at", esDia(fechaHasta) ? dayRangeUtc(fechaHasta, tz).hasta : fechaHasta)
      }
    }

    if (search) {
      // Escapado: una coma o un paréntesis en la búsqueda ("Pérez, Juan")
      // rompía el filtro .or() de PostgREST y el listado respondía 500.
      const termino = escapeOrIlikeTerm(search)
      const filters = termino
        ? [
            `cliente_nombre.ilike.%${termino}%`,
            `cliente_telefono.ilike.%${termino}%`,
            `observaciones.ilike.%${termino}%`,
          ]
        : []

      // Si es un número, buscar también por numero_venta exacto
      if (/^\d+$/.test(search.trim())) {
        filters.push(`numero_venta.eq.${parseInt(search.trim(), 10)}`)
      }

      if (filters.length > 0) query = query.or(filters.join(","))
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

    // El cliente tiene que ser de la organización (también lo controla
    // crear_venta_atomica desde la migración 332): si no, la deuda o el saldo
    // a favor se movían en la cuenta de un cliente ajeno.
    if (data.clienteId) {
      const { data: cliente } = await supabaseAdmin
        .from("clientes")
        .select("id")
        .eq("id", data.clienteId)
        .eq("organization_id", organizationId!)
        .maybeSingle()
      if (!cliente) {
        return NextResponse.json({ error: "Cliente no encontrado" }, { status: 400 })
      }
    }

    // "Saldo a favor" (CUENTA_CORRIENTE) descuenta de la cuenta del cliente:
    // sin cliente la venta quedaba cobrada sin descontar nada de ningún lado.
    const usaSaldoAFavor =
      (data.pagos ?? []).some((p) => p.metodo === "CUENTA_CORRIENTE") ||
      (!data.pagos?.length && !data.pagosParcial && data.metodoPago === "CUENTA_CORRIENTE")
    if (usaSaldoAFavor && !data.clienteId) {
      return NextResponse.json(
        { error: "Para cobrar con saldo a favor la venta tiene que tener un cliente" },
        { status: 400 }
      )
    }

    // Precio efectivo por método de pago: el método-condición (pago de mayor monto)
    // fija un factor que sube el precio de venta (ingreso real, no recargo bancario).
    const recargosMetodo = await getRecargosMetodo(organizationId!)
    const parcial = !!data.pagosParcial
    const cobro = condicionDeCobro(data.pagos, data.metodoPago, parcial, recargosMetodo)

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
    const fiscal: FiscalConfig = {
      regimen: ivaRegimen as IvaRegimen,
      tasa: ivaTasa,
      redondeoEfectivo: Number(orgFiscal?.redondeo_efectivo ?? 0),
    }

    // Totales con la misma función que muestra el POS (lib/ventas/totales.ts).
    // Convención: venta.subtotal = bruto (Σ cantidad×precio); venta.descuento =
    // descuento total (por línea + global); venta.total = bruto − descuento,
    // más IVA aditivo y redondeo de efectivo.
    const descuentoGlobal: DescuentoConfig =
      data.tipoDescuento === "PORCENTAJE"
        ? { tipo: "PORCENTAJE", valor: data.porcentajeDescuento }
        : { tipo: "MONTO", valor: data.descuento }
    const totales = calcularTotalesVenta(data.items, descuentoGlobal, fiscal, cobro.efectivo, cobro.factor)
    const subtotal = totales.subtotal
    const descuentoMonto = totales.descuentoTotal
    const total = totales.total
    const ivaNeto = totales.neto
    const ivaMonto = totales.iva
    const redondeoMonto = totales.redondeo
    const fiscalActivo = ivaRegimen !== "EXENTO" || redondeoMonto !== 0

    // Pagos contra el total, al centavo. Los que cubren el total con hasta un
    // centavo de diferencia se ajustan para sumar exacto: si no, el SQL deja
    // $0,01 de deuda en la cuenta del cliente (o rechaza la venta sin cliente).
    const conciliacion = conciliarPagos(data.pagos ?? [], total, parcial)

    // Una venta con saldo pendiente requiere un cliente
    if (conciliacion.saldoPendiente > 0 && !data.clienteId) {
      return NextResponse.json(
        { error: "Para una venta a cuenta corriente (sin cobro total) tenés que seleccionar un cliente." },
        { status: 400 }
      )
    }
    if (conciliacion.error) {
      return NextResponse.json({ error: conciliacion.error }, { status: 400 })
    }

    // Preparar items para la función atómica. Precio y descuento se persisten
    // con el factor del método aplicado (precio efectivo = ingreso real), así
    // cada línea suma lo mismo que el total de la venta.
    const pItems = data.items.map(item => {
      const linea = lineaConRecargo(item, cobro.factor)
      return {
        inventarioId: item.inventarioId || null,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precioUnitario: linea.precioUnitario,
        diasGarantia: item.diasGarantia,
        descuento: linea.descuento,
        tipoDescuento: item.tipoDescuento,
        porcentajeDescuento: item.porcentajeDescuento,
        ...(item.serieIds && item.serieIds.length > 0 && { serieIds: item.serieIds }),
        ...(item.costo != null && { costo: item.costo }),
      }
    })

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

    if (data.pagos && data.pagos.length > 0) {
      rpcParams.p_pagos = conciliacion.pagos
    } else if (!parcial && data.metodoPago === "CUENTA_CORRIENTE") {
      // Camino viejo (sin array de pagos) pagando todo con saldo a favor: el
      // SQL registraba el pago sin descontar el saldo del cliente. Como pago
      // explícito pasa por usar_cuenta_corriente, que descuenta y valida.
      rpcParams.p_pagos = [{ metodo: "CUENTA_CORRIENTE", monto: total }]
    } else if (parcial) {
      // Deferred payment ("paga después"): send empty array
      // RPC distinguishes NULL (legacy full payment) vs empty array (no payments)
      rpcParams.p_pagos = []
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

    let advertencia: string | undefined

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
        // La venta ya está creada (stock descontado, pagos y deuda
        // registrados): responder 500 hacía creer que falló y el cajero la
        // volvía a cargar. Se avisa y se sigue.
        console.error("Error al guardar snapshot IVA:", ivaError)
        advertencia = "La venta se registró, pero no se pudieron guardar los datos de IVA. Revisala en el detalle."
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
      ...(advertencia ? { advertencia } : {}),
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
