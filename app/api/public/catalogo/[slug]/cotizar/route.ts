import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getNextQuoteNumber } from "@/lib/counters"
import { randomBytes } from "crypto"
import { z } from "zod"
import { resolvePlantilla } from "@/lib/whatsapp/plantillas-catalog"
import { hasPlanFeature } from "@/lib/subscriptions"
import { stockDisponibleCatalogo } from "@/lib/catalogo/stock-disponible"

const cotizarSchema = z.object({
  cliente: z.object({
    nombre: z.string().min(1).max(120),
    telefono: z.string().min(4).max(40),
    email: z.string().email().optional().or(z.literal("")),
  }),
  notas: z.string().max(1000).optional(),
  cuponCodigo: z.string().min(3).max(32).optional(),
  // Consent explícito requerido (compliance Ley 25.326 / GDPR-like).
  // Sin true acá, rechazamos la solicitud.
  consent: z.literal(true),
  items: z.array(z.object({
    itemId: z.string(),
    varianteId: z.string().nullable().optional(),
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
    .select("organization_id, activo, whatsapp, titulo")
    .eq("slug", slug)
    .maybeSingle()

  if (!config || !config.activo) {
    return NextResponse.json({ error: "Catálogo no encontrado" }, { status: 404 })
  }

  const organizationId = config.organization_id

  // Gate de plan: catálogos de orgs Free no reciben nuevas cotizaciones.
  // Chequeo público (sin auth) — corre ANTES de tocar el carrito para no
  // hacer ningún trabajo de cotización si el org no tiene la feature.
  const tieneCotizaciones = await hasPlanFeature(organizationId, "cotizaciones_online")
  if (!tieneCotizaciones) {
    return NextResponse.json(
      { error: "Este catálogo no está tomando solicitudes de cotización en este momento", code: "FEATURE_REQUIRED" },
      { status: 403 }
    )
  }

  // 2. Cargar items del carrito + validar existencia y stock
  const itemIds = Array.from(new Set(data.items.map((i) => i.itemId)))
  const { data: catalogItems, error: itemsErr } = await supabaseAdmin
    .from("catalogo_items")
    .select(`
      id, nombre, precio, stock, inventario_id, activo, tipo,
      inventario:inventario(id, stock, stock_reservado, nombre),
      variantes:catalogo_variantes(id, etiqueta, sku, precio, stock, activo)
    `)
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

  // 3. Validar stock + variante + precio
  for (const cartItem of data.items) {
    const item: any = itemMap.get(cartItem.itemId)
    const variantesActivas: any[] = (item.variantes ?? []).filter((v: any) => v.activo)
    const tieneVariantes = variantesActivas.length > 0

    if (tieneVariantes && !cartItem.varianteId) {
      return NextResponse.json({
        error: `Falta elegir variante para "${item.nombre}"`,
      }, { status: 400 })
    }

    if (cartItem.varianteId) {
      const variante = variantesActivas.find((v) => v.id === cartItem.varianteId)
      if (!variante) {
        return NextResponse.json({
          error: `Variante no disponible para "${item.nombre}"`,
        }, { status: 400 })
      }
      const precioEfectivo = variante.precio != null ? Number(variante.precio) : item.precio
      if (precioEfectivo == null) {
        return NextResponse.json({
          error: `"${item.nombre} - ${variante.etiqueta}" requiere consulta de precio.`,
        }, { status: 400 })
      }
      if (variante.stock != null && variante.stock < cartItem.cantidad) {
        return NextResponse.json({
          error: `Stock insuficiente para "${item.nombre} - ${variante.etiqueta}" (disponible: ${variante.stock})`,
        }, { status: 409 })
      }
      continue
    }

    // Sin variantes: validar disponibilidad + precio del item base.
    // Disponibilidad = stock - stock_reservado sobre inventario: el chequeo
    // previo tiene que mirar lo mismo que el storefront y lo mismo que la RPC,
    // o el comprador ve "disponible" y recién falla al confirmar.
    const stockReal = stockDisponibleCatalogo(item)
    if (stockReal != null && stockReal < cartItem.cantidad) {
      return NextResponse.json({
        error: `Stock insuficiente para "${item.nombre}" (disponible: ${stockReal})`,
      }, { status: 409 })
    }
    if (item.precio == null) {
      return NextResponse.json({
        error: `"${item.nombre}" requiere consulta de precio. Contactá directamente.`,
      }, { status: 400 })
    }
  }

  // 5. Cliente: buscar por teléfono dentro de la org, o crear.
  // SEGURIDAD: flujo público anónimo. NO sobrescribimos nombre/email de un
  // cliente existente (un atacante con un teléfono conocido podría pisar
  // los datos de contacto del cliente real). Si difieren, loggeamos para
  // que el admin pueda revisar/mergear manualmente. La cotización guarda
  // el snapshot del nombre que el visitante envió (ver paso 6+).
  const telefonoNorm = data.cliente.telefono.trim()
  const nombreNuevo = data.cliente.nombre.trim()
  const emailNuevo = data.cliente.email?.trim() || null

  const { data: clienteExistente } = await supabaseAdmin
    .from("clientes")
    .select("id, nombre, email")
    .eq("organization_id", organizationId)
    .eq("telefono", telefonoNorm)
    .maybeSingle()

  let clienteId: string
  if (clienteExistente) {
    clienteId = clienteExistente.id
    const nameDiff = nombreNuevo && nombreNuevo !== clienteExistente.nombre
    const emailDiff = emailNuevo && emailNuevo !== clienteExistente.email
    if (nameDiff || emailDiff) {
      console.warn("[catalogo/cotizar] cliente existente con datos distintos — no se sobreescribe", {
        clienteId,
        organizationId,
        telefonoSuffix: telefonoNorm.slice(-4),
        nameDiff,
        emailDiff,
      })
    }
  } else {
    const { data: nuevoCliente, error: clienteErr } = await supabaseAdmin
      .from("clientes")
      .insert({
        organization_id: organizationId,
        nombre: nombreNuevo,
        telefono: telefonoNorm,
        email: emailNuevo,
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
    const variantesActivas: any[] = (item.variantes ?? []).filter((v: any) => v.activo)
    const variante = cartItem.varianteId
      ? variantesActivas.find((v) => v.id === cartItem.varianteId)
      : null
    const precioUnitario = variante?.precio != null
      ? Number(variante.precio)
      : Number(item.precio)
    const subtotal = precioUnitario * cartItem.cantidad
    const descripcion = variante
      ? `${item.nombre} — ${variante.etiqueta}`
      : item.nombre
    return {
      catalogoItemId: item.id,
      inventarioId: item.inventario_id,
      varianteId: variante?.id ?? null,
      varianteEtiqueta: variante?.etiqueta ?? null,
      descripcion,
      cantidad: cartItem.cantidad,
      precioUnitario,
      subtotal,
      comentarioCliente: cartItem.comentario?.trim() || null,
      adjuntos: cartItem.adjuntos ?? [],
    }
  })

  const subtotal = itemsCalculados.reduce((s, i) => s + i.subtotal, 0)
  const iva = 0

  // 7. Crear cotización + reservar stock + CONSUMIR cupón + items + abandono
  // en una sola transacción (RPC plpgsql). El cupón se consume DENTRO de la RPC
  // (fix ERR-02): si cualquier paso falla, el incremento de usos_actuales
  // rollbackea solo — nunca queda un cupón consumido sin cotización. La RPC
  // valida el cupón, calcula descuento + total y los devuelve.
  const numeroCotizacion = await getNextQuoteNumber(organizationId)
  const publicToken = randomBytes(16).toString("hex")

  const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc("crear_cotizacion_publica_atomica", {
    p_cotizacion: {
      organization_id: organizationId,
      cliente_id: clienteId,
      numero_cotizacion: numeroCotizacion,
      public_token: publicToken,
      notas: data.notas?.trim() || "Solicitud desde catálogo público",
      subtotal,
      iva,
      cupon_codigo: data.cuponCodigo ? data.cuponCodigo.toUpperCase() : null,
    },
    p_items: itemsCalculados.map((i) => ({
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precio_unitario: i.precioUnitario,
      subtotal: i.subtotal,
      inventario_id: i.inventarioId,
      catalogo_item_id: i.catalogoItemId,
      comentario_cliente: i.comentarioCliente,
      adjuntos: i.adjuntos,
      variante_id: i.varianteId,
      variante_etiqueta: i.varianteEtiqueta,
    })),
    p_stock_items: data.items.map((i) => ({
      item_id: i.itemId,
      variante_id: i.varianteId ?? null,
      cantidad: i.cantidad,
    })),
    p_telefono: telefonoNorm,
  })

  if (rpcErr || !rpcResult?.ok) {
    console.error("Error en crear_cotizacion_publica_atomica:", rpcErr)
    // Toda la transacción (stock + cupón + cotización) rollbackeó. No hay nada
    // que revertir a mano. P0003 = stock insuficiente, P0004 = cupón inválido.
    let status = 500
    let msg = "Error al crear cotización"
    if (rpcErr?.code === "P0003") {
      status = 409
      msg = rpcErr.message
    } else if (rpcErr?.code === "P0004") {
      status = 400
      msg = rpcErr.message
    }
    return NextResponse.json({ error: msg }, { status })
  }

  // La RPC ya consumió el cupón y calculó descuento + total atómicamente.
  const total = Number(rpcResult.total) || 0
  const cuponCodigoAplicado = (rpcResult.cupon_codigo as string | null) ?? null
  const cuponDescuento = Number(rpcResult.cupon_descuento) || 0

  const cotizacion = {
    id: rpcResult.cotizacion_id as string,
    public_token: publicToken,
    numero_cotizacion: numeroCotizacion,
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
          action_url: `/cotizaciones?abrir=${cotizacion.id}`,
          cliente_id: clienteId,
        }))
      )
    }
  } catch (err) {
    console.error("Error notificando solicitud catálogo:", err)
    // No bloqueante — la cotización ya se creó
  }

  // 11. Hybrid: armar wa.me URL al WhatsApp del taller con resumen para que
  // el cliente lo "envíe" desde su WhatsApp. Refuerza que el taller reciba la
  // solicitud en su canal habitual y abra contacto directo con el cliente.
  let whatsappTallerUrl: string | null = null
  if (config.whatsapp) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ""
    const linkPublico = appUrl
      ? `${appUrl}/cotizacion/${cotizacion.public_token}`
      : `/cotizacion/${cotizacion.public_token}`
    const tallerNombre = config.titulo || ""
    const itemsResumen = itemsCalculados
      .slice(0, 8)
      .map((i) => `• ${i.cantidad}× ${i.descripcion}`)
      .join("\n")
    const restantes =
      itemsCalculados.length > 8 ? `\n…y ${itemsCalculados.length - 8} más` : ""
    const cuponLinea = cuponCodigoAplicado
      ? `\nCupón: ${cuponCodigoAplicado} (− $${cuponDescuento.toLocaleString("es-AR")})`
      : ""

    // Cargar plantillas custom de la org (override sobre defaultText del catálogo).
    const { data: orgRow } = await supabaseAdmin
      .from("organizations")
      .select("plantillas_whatsapp")
      .eq("id", organizationId)
      .maybeSingle()
    const orgPlantillas = (orgRow?.plantillas_whatsapp as Record<string, string> | null) ?? null

    const msg = resolvePlantilla(
      "catalogo_solicitud_taller",
      {
        taller: tallerNombre,
        numero_cotizacion: String(cotizacion.numero_cotizacion),
        cliente: data.cliente.nombre.trim(),
        telefono: telefonoNorm,
        items: `${itemsResumen}${restantes}`,
        total: `$${total.toLocaleString("es-AR")}`,
        linea_cupon: cuponLinea,
        link_publico: linkPublico,
      },
      orgPlantillas,
    )
    const telLimpio = config.whatsapp.replace(/\D/g, "")
    whatsappTallerUrl = `https://wa.me/${telLimpio}?text=${encodeURIComponent(msg)}`
  }

  return NextResponse.json({
    cotizacionToken: cotizacion.public_token,
    numeroCotizacion: cotizacion.numero_cotizacion,
    url: `/cotizacion/${cotizacion.public_token}`,
    whatsappTallerUrl,
  }, { status: 201 })
}
