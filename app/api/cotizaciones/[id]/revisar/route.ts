import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { randomBytes } from "crypto"

// Crea una revision de una cotizacion ACEPTADA: la firma del cliente queda
// atada a esa fila exacta (y a la reserva de stock hecha sobre sus items),
// asi que corregirla en el lugar la dejaria describiendo un documento
// distinto del que se firmo. En vez de eso, esta ruta clona los datos en una
// cotizacion nueva en BORRADOR y jamas escribe sobre la original: ni su
// `estado`, ni su firma, ni (todavia) `reemplazada_por` — esa columna la
// escribe el envio de la revision, para que un borrador abandonado nunca deje
// huerfana a la cotizacion aceptada.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    // Cargar la cotizacion origen, scopeada a la organizacion del caller.
    // `deleted_at IS NULL` va en la query, como en enviar/ y aprobar/: una fila
    // borrada no existe para el caller, y 404 es la respuesta correcta.
    const { data: source, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (fetchError || !source) {
      return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 })
    }

    if (source.estado !== "ACEPTADA") {
      return NextResponse.json(
        { error: "Solo se pueden revisar cotizaciones aceptadas" },
        { status: 400 }
      )
    }

    // Una fila ya reemplazada sigue en ACEPTADA a proposito (migracion 311: es
    // un hecho historico firmado, no se pisa el estado), asi que el guard de
    // arriba la deja pasar. La UI esconde el boton, pero eso no es enforcement:
    // revisar dos veces la misma original crea dos revisiones que apuntan a
    // ella, y al aprobar la segunda la migracion 312 llama
    // `liberar_items_cotizacion` por segunda vez sobre la original. Como
    // `stock_reservado` es un contador global por item, esa segunda liberacion
    // le come la reserva a OTRAS cotizaciones del mismo item (subreserva),
    // mientras las dos revisiones suman al presupuesto de la orden.
    // Mismo guard que convertir-venta/route.ts.
    if (source.reemplazada_por) {
      return NextResponse.json(
        {
          error:
            "Esta cotización ya fue reemplazada por una revisión; revisá la revisión vigente en su lugar",
        },
        { status: 400 }
      )
    }

    // Items de la cotizacion origen, a copiar tal cual en la revision.
    const { data: sourceItems, error: itemsFetchError } = await supabaseAdmin
      .from("items_cotizacion")
      .select("*")
      .eq("cotizacion_id", source.id)

    if (itemsFetchError) throw itemsFetchError

    // El link publico por el que el cliente firma. Se genera aca, igual que en
    // POST /api/cotizaciones y en duplicar/: la columna no tiene DEFAULT ni
    // trigger, y `enviar` no la escribe. Sin token, la revision no se puede
    // compartir (los botones Compartir/WhatsApp cortan mudos si publicToken es
    // null) y las paginas publicas de firma y rechazo son inalcanzables — o
    // sea, la revision no se puede firmar nunca, que es todo el punto.
    // 16 bytes -> 32 caracteres hex, el largo exacto que validan las rutas
    // publicas (`token.length !== 32`).
    const publicToken = randomBytes(16).toString("hex")

    // No se copian firma_aprobacion, firma_mime ni fecha_aprobacion: la
    // revision esta sin firmar y se firma de nuevo. Tampoco fecha_vencimiento:
    // es una oferta nueva, heredar el vencimiento de la original podria crearla
    // ya vencida; la consigue al enviarse, igual que cualquier cotizacion.
    //
    // Si copia tipo, notas, sector_id, equipo_snapshot, checklist_snapshot y
    // tipo_cambio: una revision es el mismo trabajo re-cotizado, asi que todo
    // lo que describe QUE se esta cotizando tiene que sobrevivir. tipo es el
    // campo critico aca — la columna tiene DEFAULT 'ORDEN', asi que omitirlo
    // convierte en silencio la revision de un PRESUPUESTO en una ORDEN.
    const { data: revision, error: createError } = await supabaseAdmin
      .from("cotizaciones")
      .insert({
        organization_id: organizationId,
        orden_id: source.orden_id,
        cliente_id: source.cliente_id,
        sector_id: source.sector_id,
        numero_cotizacion: source.numero_cotizacion,
        public_token: publicToken,
        estado: "BORRADOR",
        tipo: source.tipo,
        notas: source.notas,
        terminos: source.terminos,
        iva_porcentaje: source.iva_porcentaje,
        descuento_global_tipo: source.descuento_global_tipo,
        descuento_global_valor: source.descuento_global_valor,
        tipo_cambio: source.tipo_cambio,
        equipo_snapshot: source.equipo_snapshot,
        checklist_snapshot: source.checklist_snapshot,
        subtotal: source.subtotal,
        iva: source.iva,
        total: source.total,
        revision_de: source.id,
        created_by: userId,
      })
      .select()
      .single()

    if (createError) throw createError

    const items = sourceItems || []
    if (items.length > 0) {
      const { error: itemsError } = await supabaseAdmin
        .from("items_cotizacion")
        .insert(
          items.map((item: any) => ({
            cotizacion_id: revision.id,
            descripcion: item.descripcion,
            cantidad: item.cantidad,
            precio_unitario: item.precio_unitario,
            costo_unitario: item.costo_unitario ?? null,
            subtotal: item.subtotal,
            unidad: item.unidad || "Unidad",
            descuento_tipo: item.descuento_tipo || "porcentaje",
            descuento_valor: item.descuento_valor || 0,
            inventario_id: item.inventario_id ?? null,
            servicio_id: item.servicio_id ?? null,
            tipo_repuesto: item.tipo_repuesto || "NO_APLICA",
            catalogo_item_id: item.catalogo_item_id ?? null,
          }))
        )

      if (itemsError) {
        // No dejar una revision a medio crear: la origen sigue intacta,
        // pero la revision fallida no debe quedar sin items.
        await supabaseAdmin.from("cotizaciones").delete().eq("id", revision.id)
        throw itemsError
      }
    }

    return NextResponse.json({ id: revision.id }, { status: 201 })
  } catch (error) {
    console.error("Error creating cotizacion revision:", error)
    return NextResponse.json(
      { error: "Error al crear la revisión de la cotización" },
      { status: 500 }
    )
  }
}
