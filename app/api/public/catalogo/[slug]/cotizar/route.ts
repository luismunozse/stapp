import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getNextQuoteNumber } from "@/lib/counters"
import { randomBytes } from "crypto"
import { z } from "zod"
import { resolvePlantilla } from "@/lib/whatsapp/plantillas-catalog"

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

  // 2. Cargar items del carrito + validar existencia y stock
  const itemIds = Array.from(new Set(data.items.map((i) => i.itemId)))
  const { data: catalogItems, error: itemsErr } = await supabaseAdmin
    .from("catalogo_items")
    .select(`
      id, nombre, precio, stock, inventario_id, activo, tipo,
      inventario:inventario(id, stock, nombre),
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

    // Sin variantes: validar stock + precio del item base
    const stockReal = item.inventario_id && item.inventario
      ? item.inventario.stock
      : item.stock
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

  // 7. Crear cotización + items + reservar stock + marcar abandono en una
  // sola transacción (RPC plpgsql). Si cualquier paso falla, ROLLBACK total
  // — no quedan cotizaciones huérfanas, stock no se decrementa, abandono
  // no se marca. El cupón ya fue aplicado arriba; si esta RPC falla hay
  // que revertirlo manualmente.
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
      total,
      cupon_id: cuponId,
      cupon_codigo: cuponCodigoAplicado,
      cupon_descuento: cuponDescuento > 0 ? cuponDescuento : null,
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
    if (cuponId) {
      await revertirCupon(cuponId)
    }
    // P0003 = stock insuficiente (raise de reservar_stock_catalogo)
    const status = rpcErr?.code === "P0003" ? 409 : 500
    const msg = rpcErr?.code === "P0003" ? rpcErr.message : "Error al crear cotización"
    return NextResponse.json({ error: msg }, { status })
  }

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
