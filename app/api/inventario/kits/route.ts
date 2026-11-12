import { NextResponse } from "next/server"
import { requireAuth, hasInventarioAccess, resolveVendedoresHabilitados } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { cargarConfigMoneda, resolverTipoCambio } from "@/lib/currency/tipo-cambio.server"
import { costoKitLocal, type MonedaCatalogo } from "@/lib/currency/catalogo"
import type { ConfigMoneda } from "@/lib/currency/config-moneda"
import type { ResultadoTipoCambio } from "@/lib/currency/tipo-cambio"

// GET /api/inventario/kits
// Lista items con es_kit=true, con conteo de componentes y costo calculado.
export async function GET(request: Request) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search")?.trim() ?? ""
    const tipoKit = searchParams.get("tipoKit") // "ENSAMBLADO" | "VIRTUAL" | null

    let query = supabaseAdmin
      .from("inventario")
      .select(
        "id, codigo, nombre, stock, stock_reservado, precio_compra, precio_venta, tipo_kit, imagen_url, categoria, tipo_dispositivo",
        { count: "exact" }
      )
      .eq("organization_id", organizationId!)
      .eq("es_kit", true)
      .is("deleted_at", null)
      .order("nombre", { ascending: true })

    if (tipoKit === "ENSAMBLADO" || tipoKit === "VIRTUAL") {
      query = query.eq("tipo_kit", tipoKit)
    }

    if (search.length > 0) {
      const safe = search.replace(/[,()\\]/g, "\\$&")
      query = query.or(`nombre.ilike.%${safe}%,codigo.ilike.%${safe}%`)
    }

    const { data: kits, error: dbErr, count } = await query
    if (dbErr) throw dbErr

    const kitIds = (kits || []).map((k) => k.id)

    // Conteo de componentes por kit
    let conteoMap = new Map<string, number>()
    if (kitIds.length > 0) {
      const { data: items } = await supabaseAdmin
        .from("inventario_kit_items")
        .select("kit_id")
        .in("kit_id", kitIds)
        .eq("organization_id", organizationId!)

      for (const r of items || []) {
        conteoMap.set(r.kit_id, (conteoMap.get(r.kit_id) ?? 0) + 1)
      }
    }

    // Costo agregado por kit (consulta directa en lugar de N RPCs). Los componentes pueden estar
    // en divisa: el costo se calcula en moneda local y es null si algún componente no tiene equivalente.
    const costoMap = new Map<string, number | null>()
    let monedaExtranjera: string | null = null
    if (kitIds.length > 0) {
      const { data: costRows } = await supabaseAdmin
        .from("inventario_kit_items")
        .select("kit_id, cantidad, componente:componente_id(precio_compra, moneda)")
        .in("kit_id", kitIds)
        .eq("organization_id", organizationId!)

      type CompCosto = { precioCompra: number | null; moneda: MonedaCatalogo }
      const lista = new Map<string, Array<{ cantidad: number } & CompCosto>>()
      for (const raw of costRows || []) {
        const r = raw as unknown as {
          kit_id: string
          cantidad: number
          componente:
            | { precio_compra: number | null; moneda?: MonedaCatalogo }
            | Array<{ precio_compra: number | null; moneda?: MonedaCatalogo }>
            | null
        }
        const comp = Array.isArray(r.componente)
          ? r.componente[0] ?? null
          : r.componente
        const arr = lista.get(r.kit_id) ?? []
        arr.push({
          cantidad: r.cantidad,
          precioCompra: comp?.precio_compra == null ? null : Number(comp.precio_compra),
          moneda: comp?.moneda ?? null,
        })
        lista.set(r.kit_id, arr)
      }

      // Cotización: una sola vez por request y solo si algún componente está en divisa.
      const hayDivisa = [...lista.values()].some((cs) => cs.some((c) => c.moneda !== null))
      let config: ConfigMoneda | null = null
      let tc: ResultadoTipoCambio | null = null
      if (canViewCost && hayDivisa) {
        config = (await cargarConfigMoneda(organizationId!)).config
        tc = await resolverTipoCambio(organizationId!)
        monedaExtranjera = config.monedaExtranjera
      }
      for (const [kitId, cs] of lista) {
        if (config === null) {
          costoMap.set(kitId, cs.reduce((acc, c) => acc + c.cantidad * (c.precioCompra ?? 0), 0))
        } else {
          costoMap.set(kitId, costoKitLocal(cs, config, tc))
        }
      }
    }

    const data = (kits || []).map((k) => ({
      id: k.id,
      codigo: k.codigo,
      nombre: k.nombre,
      stock: k.stock ?? 0,
      stockReservado: k.stock_reservado ?? 0,
      precioCompra: canViewCost ? Number(k.precio_compra ?? 0) : null,
      precioVenta: Number(k.precio_venta ?? 0),
      tipoKit: k.tipo_kit ?? null,
      imagenUrl: k.imagen_url ?? null,
      categoria: k.categoria,
      tipoDispositivo: k.tipo_dispositivo,
      cantidadComponentes: conteoMap.get(k.id) ?? 0,
      costoCalculado: canViewCost ? (costoMap.get(k.id) ?? (costoMap.has(k.id) ? null : 0)) : null,
      // Con acceso a costos pero sin equivalente local: distinto de "oculto" (que también es null).
      costoNoDisponible: canViewCost && costoMap.get(k.id) === null,
    }))

    return NextResponse.json({
      data,
      total: count ?? data.length,
      monedaExtranjera,
    })
  } catch (err) {
    console.error("Error fetching kits:", err)
    return NextResponse.json(
      { error: "Error al obtener kits" },
      { status: 500 }
    )
  }
}
