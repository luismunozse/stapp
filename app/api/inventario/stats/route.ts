import { NextResponse } from "next/server"
import { requireAuth, hasInventarioAccess, resolveVendedoresHabilitados } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { resolverContextoValuacion, valuarLocal, contarExcluidos } from "@/lib/currency/valuacion.server"

// Stats agregadas para el header de /inventario:
// - totalSkus, valor a costo, valor a venta, sin stock, bajo stock, valor en riesgo
// Una sola query SQL en la base usando aggregations.
export async function GET() {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    // Umbral global desde la organización (fallback 5)
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("umbral_stock_bajo")
      .eq("id", organizationId!)
      .single()
    const globalThreshold = org?.umbral_stock_bajo ?? 5

    // Traer items activos. Sólo necesitamos los campos para agregar.
    // Para una org con miles de SKUs esto sigue siendo barato (una columna).
    const { data: items, error: dbError } = await supabaseAdmin
      .from("inventario")
      .select("stock, stock_reservado, precio_compra, precio_venta, stock_minimo, moneda")
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)

    if (dbError) throw dbError

    let totalSkus = 0
    let sinStock = 0
    let bajoStock = 0

    // Cada monto se calcula en la moneda del ítem y se suma en local (cotización una sola vez,
    // y solo si algún ítem está en divisa).
    const rows = (items || []).map((item) => {
      const stock = item.stock || 0
      const precioCompra = Number(item.precio_compra) || 0
      const precioVenta = Number(item.precio_venta) || 0
      const minimoEfectivo = item.stock_minimo ?? globalThreshold
      let riesgo = 0
      totalSkus++
      if (stock === 0) {
        sinStock++
        // Para items sin stock, el "valor en riesgo" es lo que costaría reponer al mínimo.
        riesgo = minimoEfectivo * precioCompra
      } else if (stock <= minimoEfectivo) {
        bajoStock++
        // Para bajo stock: lo que costaría llegar al mínimo.
        riesgo = Math.max(0, minimoEfectivo - stock) * precioCompra
      }
      return {
        moneda: (item.moneda ?? null) as "USD" | "EUR" | null,
        costo: stock * precioCompra,
        venta: stock * precioVenta,
        riesgo,
      }
    })
    const ctx = await resolverContextoValuacion(organizationId!, rows)
    const vCosto = valuarLocal(rows, (r) => r.costo, ctx)
    const vVenta = valuarLocal(rows, (r) => r.venta, ctx)
    const vRiesgo = valuarLocal(rows, (r) => r.riesgo, ctx)
    const valorCosto = vCosto.total
    const valorVenta = vVenta.total
    const valorEnRiesgo = vRiesgo.total
    const aproximado = vCosto.aproximado || vVenta.aproximado || vRiesgo.aproximado
    const excluidosSinCotizacion = contarExcluidos(rows, ctx)

    // valorCosto y valorEnRiesgo salen de precio_compra, así que van detrás del
    // mismo permiso que el costo de cada item. Los conteos y el valor a venta
    // no son costo y siguen disponibles para todos los roles.
    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

    // La respuesta depende del rol, así que una cache con clave solo de URL no
    // sirve. `Vary: Cookie` mete la sesión en la clave del navegador: otro
    // login es otra entrada, nunca la copia del ADMIN.
    //
    // El ADMIN conserva la cache de 60s (este endpoint se dispara en cada
    // montaje de /inventario) porque su acceso al costo sale de session.role,
    // que ya queda fijo mientras dura la sesión: cachear no agrega staleness.
    // El VENDEDOR no la conserva: su acceso depende de
    // vendedores_administran_inventario, que se resuelve vivo en cada request,
    // y cachear le dejaría el costo a la vista hasta un minuto después de que
    // un admin le revoque el permiso.
    const cacheControl = role === "ADMIN" ? "private, max-age=60" : "no-store"

    return NextResponse.json(
      {
        totalSkus,
        valorCosto: canViewCost ? Math.round(valorCosto * 100) / 100 : null,
        valorVenta: Math.round(valorVenta * 100) / 100,
        sinStock,
        bajoStock,
        valorEnRiesgo: canViewCost ? Math.round(valorEnRiesgo * 100) / 100 : null,
        aproximado,
        excluidosSinCotizacion,
      },
      {
        headers: { "Cache-Control": cacheControl, Vary: "Cookie" },
      }
    )
  } catch (error) {
    console.error("Error fetching inventario stats:", error)
    return NextResponse.json(
      { error: "Error al obtener estadísticas de inventario" },
      { status: 500 }
    )
  }
}
