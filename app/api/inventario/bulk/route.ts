import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Se requiere al menos un item"),
  action: z.enum(["archive", "set_category", "price_adjust", "set_proveedor"]),
  payload: z
    .object({
      categoria: z.string().optional(),
      // price_adjust: porcentaje (-99..1000) y campo a ajustar
      percent: z.number().min(-99).max(1000).optional(),
      target: z.enum(["precioVenta", "precioCompra"]).optional(),
      // set_proveedor: id del proveedor o null para quitar
      proveedorId: z.string().min(1).nullable().optional(),
    })
    .optional(),
})

export async function PATCH(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const { ids, action, payload } = bulkSchema.parse(body)

    // Asegurar que TODOS los ids pertenecen a la organización del usuario.
    // Sin esto, un admin podría afectar items de otra org pasando ids ajenos.
    const { data: owned, error: checkError } = await supabaseAdmin
      .from("inventario")
      .select("id")
      .eq("organization_id", organizationId!)
      .in("id", ids)

    if (checkError) throw checkError
    if (!owned || owned.length !== ids.length) {
      return NextResponse.json(
        { error: "Algunos items no existen o no pertenecen a tu organización" },
        { status: 403 }
      )
    }

    let updatedCount = 0

    if (action === "archive") {
      const { data, error: dbError } = await supabaseAdmin
        .from("inventario")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: userId,
        })
        .in("id", ids)
        .eq("organization_id", organizationId!)
        .is("deleted_at", null)
        .select("id")

      if (dbError) throw dbError
      updatedCount = data?.length || 0
    } else if (action === "set_category") {
      const categoria = payload?.categoria
      if (!categoria || !categoria.trim()) {
        return NextResponse.json(
          { error: "Categoría requerida" },
          { status: 400 }
        )
      }
      const { data, error: dbError } = await supabaseAdmin
        .from("inventario")
        .update({ categoria, updated_at: new Date().toISOString() })
        .in("id", ids)
        .eq("organization_id", organizationId!)
        .is("deleted_at", null)
        .select("id")

      if (dbError) throw dbError
      updatedCount = data?.length || 0
    } else if (action === "price_adjust") {
      const percent = payload?.percent
      const target = payload?.target ?? "precioVenta"
      if (percent == null || percent === 0) {
        return NextResponse.json(
          { error: "Porcentaje requerido y distinto de cero" },
          { status: 400 }
        )
      }
      // Hacemos el ajuste por SQL (multiplicador) para evitar round-trip por item.
      const column = target === "precioCompra" ? "precio_compra" : "precio_venta"
      const factor = 1 + percent / 100
      // No existe rpc estándar para multiplicar; usamos update con expresión vía rpc helper.
      // Como Supabase JS no soporta expresiones SQL en update, lo hacemos en una RPC ligera.
      // Si la RPC no existe todavía, fallback: traer + actualizar uno por uno (mantiene atomicidad por item).
      const { data: rows, error: fetchError } = await supabaseAdmin
        .from("inventario")
        .select(`id, ${column}`)
        .in("id", ids)
        .eq("organization_id", organizationId!)
        .is("deleted_at", null)

      if (fetchError) throw fetchError

      const updates = (rows || []).map((row: any) => {
        const current = Number(row[column]) || 0
        const next = Math.max(0, Math.round(current * factor * 100) / 100)
        return { id: row.id, [column]: next }
      })

      // Updates en paralelo, máximo 50 a la vez para no saturar
      const BATCH = 50
      for (let i = 0; i < updates.length; i += BATCH) {
        const batch = updates.slice(i, i + BATCH)
        await Promise.all(
          batch.map((u: any) =>
            supabaseAdmin
              .from("inventario")
              .update({ [column]: u[column], updated_at: new Date().toISOString() })
              .eq("id", u.id)
              .eq("organization_id", organizationId!)
          )
        )
      }
      updatedCount = updates.length
    } else if (action === "set_proveedor") {
      // proveedorId === null → quitar proveedor. String → setearlo.
      const proveedorId = payload?.proveedorId ?? null

      if (proveedorId) {
        // Validar que el proveedor pertenezca a la organización.
        const { data: prov, error: provErr } = await supabaseAdmin
          .from("proveedores")
          .select("id")
          .eq("id", proveedorId)
          .eq("organization_id", organizationId!)
          .maybeSingle()
        if (provErr) throw provErr
        if (!prov) {
          return NextResponse.json(
            { error: "Proveedor inválido" },
            { status: 400 }
          )
        }
      }

      const { data, error: dbError } = await supabaseAdmin
        .from("inventario")
        .update({ proveedor_id: proveedorId, updated_at: new Date().toISOString() })
        .in("id", ids)
        .eq("organization_id", organizationId!)
        .is("deleted_at", null)
        .select("id")

      if (dbError) throw dbError
      updatedCount = data?.length || 0
    }

    return NextResponse.json({ updated: updatedCount })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error in bulk inventario action:", error)
    return NextResponse.json(
      { error: "Error al ejecutar acción masiva" },
      { status: 500 }
    )
  }
}
