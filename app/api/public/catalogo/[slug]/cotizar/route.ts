import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getNextQuoteNumber } from "@/lib/counters"
import { randomBytes } from "crypto"
import { z } from "zod"

async function revertirCupon(cuponId: string) {
  try {
    await supabaseAdmin.rpc("revertir_uso_cupon_catalogo", { p_cupon_id: cuponId })
  } catch (err) {
    console.error("Error revirtiendo uso de cupón:", err)
  }
}

const cotizarSchema = z.object({
  cliente: z.object({
    nombre: z.string().min(1).max(120),
    telefono: z.string().min(4).max(40),
    email: z.string().email().optional().or(z.literal("")),
  }),
  notas: z.string().max(1000).optional(),
  cuponCodigo: z.string().min(3).max(32).optional(),
  items: z.array(z.object({
    itemId: z.string(),
    cantidad: z.number().int().positive(),
    comentario: z.string().max(500).optional(),
    adjuntos: z.array(z.string().url()).max(5).optional(),
  })).min(1),
})

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  if (!slug || !/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) {
    return NextResponse.json({ error: "Slug inválido" }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const parsed = cotizarSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data

  // 1. Validar catálogo activo
  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("organization_id, activo")
    .eq("slug", slug)
    .maybeSingle()

  if (!config || !config.activo) {
    return NextResponse.json({ error: "Catálogo no encontrado" }, { status: 404 })
  }

  const organizationId = config.organization_id

  // 2. Cargar items del carrito + validar existencia y stock
  const itemIds = data.items.map((i) => i.itemId)
  const { data: catalogItems, error: itemsErr } = await supabaseAdmin
    .from("catalogo_items")
    .select("id, nombre, precio, stock, inventario_id, activo, tipo, inventario:inventario(id, stock, nombre)")
    .in("id", itemIds)
    .eq("organization_id", organizationId)

  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })

  if (!catalogItems || catalogItems.length !== itemIds.length) {
    return NextResponse.json({ error: "Algunos items no existen" }, { status: 400 })
  }

  const inactivos = catalogItems.filter((it) => !it.activo)
  if (inactivos.length > 0) {
    return NextResponse.json({ error: "Algunos items ya no están disponibles" }, { status: 400 })
  }

  // Mapa para lookup rápido
  const itemMap = new Map(catalogItems.map((it: any) => [it.id, it]))

  // 3. Validar stock disponible
  for (const cartItem of data.items) {
    const item: any = itemMap.get(cartItem.itemId)
    const stockReal = item.inventario_id && item.inventario
      ? item.inventario.stock
      : item.stock
    if (stockReal != null && stockReal < cartItem.cantidad) {
      return NextResponse.json({
        error: `Stock insuficiente para "${item.nombre}" (disponible: ${stockReal})`,
      }, { status: 409 })
    }
  }

  // 4. Validar que tenga precio (no se puede cotizar items sin precio)
  for (const cartItem of data.items) {
    const item: any = itemMap.get(cartItem.itemId)
    if (item.precio == null) {
      return NextResponse.json({
        error: `"${item.nombre}" requiere consulta de precio. Contactá directamente.`,
      }, { status: 400 })
    }
  }

  // 5. Cliente: buscar por teléfono dentro de la org, o crear
  const telefonoNorm = data.cliente.telefono.trim()
  const { data: clienteExistente } = await supabaseAdmin
    .from("clientes")
    .select("id, nombre, telefono, email")
    .eq("organization_id", organizationId)
    .eq("telefono", telefonoNorm)
    .maybeSingle()

  let clienteId: string
  if (clienteExistente) {
    clienteId = clienteExistente.id
  } else {
    const { data: nuevoCliente, error: clienteErr } = await supabaseAdmin
      .from("clientes")
      .insert({
        organization_id: organizationId,
        nombre: data.cliente.nombre.trim(),
        telefono: telefonoNorm,
        email: data.cliente.email?.trim() || null,
      })
      .select("id")
      .single()

    if (clienteErr || !nuevoCliente) {
      console.error("Error creando cliente:", clienteErr)
      return NextResponse.json({ error: "Error al crear cliente" }, { status: 500 })
    }
    clienteId = nuevoCliente.id
  }

  // 6. Calcular totales
  const itemsCalculados = data.items.map((cartItem) => {
    const item: any = itemMap.get(cartItem.itemId)
    const precioUnitario = Number(item.precio)
    const subtotal = precioUnitario * cartItem.cantidad
    return {
      catalogoItemId: item.id,
      inventarioId: item.inventario_id,
      descripcion: item.nombre,
      cantidad: cartItem.cantidad,
      precioUnitario,
      subtotal,
      comentarioCliente: cartItem.comentario?.trim() || null,
      adjuntos: cartItem.adjuntos ?? [],
    }
  })

  const subtotal = itemsCalculados.reduce((s, i) => s + i.subtotal, 0)
  const iva = 0

  // 6.5 Cupón: aplicar atómicamente (incrementa usos_actuales)
  let cuponDescuento = 0
  let cuponId: string | null = null
  let cuponCodigoAplicado: string | null = null
  if (data.cuponCodigo) {
    const { data: cuponResult, error: cuponErr } = await supabaseAdmin.rpc("aplicar_cupon_catalogo", {
      p_organization_id: organizationId,
      p_codigo: data.cuponCodigo.toUpperCase(),
      p_subtotal: subtotal,
    })
    if (cuponErr) {
      console.error("Error aplicando cupón:", cuponErr)
      return NextResponse.json({ error: "Error al aplicar cupón" }, { status: 500 })
    }
    const cr: any = cuponResult
    if (!cr?.ok) {
      return NextResponse.json({ error: cr?.error || "Cupón inválido" }, { status: 400 })
    }
    cuponId = cr.cupon_id
    cuponCodigoAplicado = cr.codigo
    cuponDescuento = Number(cr.descuento_aplicado) || 0
  }

  const total = Math.max(0, subtotal - cuponDescuento)

  // 7. Crear cotización tipo PRESUPUESTO (sin equipo)
  const numeroCotizacion = await getNextQuoteNumber(organizationId)
  const publicToken = randomBytes(16).toString("hex")

  const { data: cotizacion, error: cotErr } = await supabaseAdmin
    .from("cotizaciones")
    .insert({
      organization_id: organizationId,
      cliente_id: clienteId,
      numero_cotizacion: numeroCotizacion,
      public_token: publicToken,
      tipo: "PRESUPUESTO",
      estado: "ENVIADA",
      origen: "CATALOGO_PUBLICO",
      notas: data.notas?.trim() || "Solicitud desde catálogo público",
      subtotal,
      iva,
      total,
      iva_porcentaje: 0,
      descuento_global_tipo: "porcentaje",
      descuento_global_valor: 0,
      cupon_id: cuponId,
      cupon_codigo: cuponCodigoAplicado,
      cupon_descuento: cuponDescuento > 0 ? cuponDescuento : null,
    })
    .select("id, public_token, numero_cotizacion")
    .single()

  if (cotErr || !cotizacion) {
    console.error("Error creando cotización:", cotErr)
    if (cuponId) {
      // Revertir uso del cupón ya que la cotización falló
      await revertirCupon(cuponId)
    }
    return NextResponse.json({ error: "Error al crear cotización" }, { status: 500 })
  }

  // 8. Insertar items_cotizacion
  const { error: itemsInsertErr } = await supabaseAdmin
    .from("items_cotizacion")
    .insert(itemsCalculados.map((i) => ({
      cotizacion_id: cotizacion.id,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precio_unitario: i.precioUnitario,
      subtotal: i.subtotal,
      unidad: "Unidad",
      descuento_tipo: "porcentaje",
      descuento_valor: 0,
      inventario_id: i.inventarioId,
      tipo_repuesto: "NO_APLICA",
      comentario_cliente: i.comentarioCliente,
      adjuntos: i.adjuntos,
    })))

  if (itemsInsertErr) {
    await supabaseAdmin.from("cotizaciones").delete().eq("id", cotizacion.id)
    if (cuponId) {
      await revertirCupon(cuponId)
    }
    console.error("Error insertando items:", itemsInsertErr)
    return NextResponse.json({ error: "Error al guardar items" }, { status: 500 })
  }

  // 9. Decrementar stock atómico via RPC (FOR UPDATE lock anti-race)
  const { error: stockErr } = await supabaseAdmin.rpc("reservar_stock_catalogo", {
    p_organization_id: organizationId,
    p_items: data.items.map((i) => ({ item_id: i.itemId, cantidad: i.cantidad })),
  })

  if (stockErr) {
    // Rollback: borrar cotización + items_cotizacion + revertir cupón
    await supabaseAdmin.from("items_cotizacion").delete().eq("cotizacion_id", cotizacion.id)
    await supabaseAdmin.from("cotizaciones").delete().eq("id", cotizacion.id)
    if (cuponId) {
      await revertirCupon(cuponId)
    }

    // P0003 = stock insuficiente (error custom de la RPC)
    const status = stockErr.code === "P0003" ? 409 : 500
    return NextResponse.json({ error: stockErr.message }, { status })
  }

  // 10. Notificar a los ADMIN de la org (in-app)
  try {
    const { data: orgAdmins } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("rol", "ADMIN")

    if (orgAdmins && orgAdmins.length > 0) {
      const totalCount = data.items.reduce((s, i) => s + i.cantidad, 0)
      const body =
        `${data.cliente.nombre.trim()} solicitó ${totalCount} item${totalCount > 1 ? "s" : ""} ` +
        `por $${total.toLocaleString("es-AR")}. Tel: ${telefonoNorm}`

      await supabaseAdmin.from("user_notifications").insert(
        orgAdmins.map((u) => ({
          organization_id: organizationId,
          user_id: u.id,
          title: "Nueva solicitud desde el catálogo",
          body,
          type: "CATALOGO_SOLICITUD",
          icon: "shopping-cart",
          action_url: `/cotizaciones/${cotizacion.id}`,
          cliente_id: clienteId,
        }))
      )
    }
  } catch (err) {
    console.error("Error notificando solicitud catálogo:", err)
    // No bloqueante — la cotización ya se creó
  }

  return NextResponse.json({
    cotizacionToken: cotizacion.public_token,
    numeroCotizacion: cotizacion.numero_cotizacion,
    url: `/cotizacion/${cotizacion.public_token}`,
  }, { status: 201 })
}
