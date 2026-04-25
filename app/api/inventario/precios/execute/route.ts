import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

const updateSchema = z.object({
  id: z.string().min(1),
  precioCompraNuevo: z.number().min(0).nullable().optional(),
  precioVentaNuevo: z.number().min(0).nullable().optional(),
})

const schema = z.object({
  updates: z.array(updateSchema).min(1, "No hay cambios para aplicar"),
  motivo: z.string().min(1).max(200).optional(),
})

const BATCH_SIZE = 50

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const { updates, motivo } = schema.parse(body)

    const ids = updates.map((u) => u.id)
    const { data: owned, error: ownErr } = await supabaseAdmin
      .from("inventario")
      .select("id, precio_compra, precio_venta")
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .in("id", ids)
    if (ownErr) throw ownErr

    const ownedMap = new Map<string, { precio_compra: number; precio_venta: number }>()
    for (const row of (owned ?? []) as Array<{ id: string; precio_compra: string | number; precio_venta: string | number }>) {
      ownedMap.set(row.id, {
        precio_compra: Number(row.precio_compra) || 0,
        precio_venta: Number(row.precio_venta) || 0,
      })
    }

    const valid = updates.filter((u) => ownedMap.has(u.id))
    if (valid.length === 0) {
      return NextResponse.json(
        { error: "Ningún ítem pertenece a tu organización" },
        { status: 403 }
      )
    }

    const motivoFinal = motivo?.trim() || "Importación de lista de precios"
    const nowIso = new Date().toISOString()
    let updatedCount = 0
    const historialRows: Array<{
      inventario_id: string
      precio_compra_anterior: number | null
      precio_compra_nuevo: number | null
      precio_venta_anterior: number | null
      precio_venta_nuevo: number | null
      motivo: string
      usuario_id: string | null
      organization_id: string
    }> = []

    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
      const batch = valid.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map(async (u) => {
          const current = ownedMap.get(u.id)!
          const patch: Record<string, unknown> = { updated_at: nowIso }
          let cambia = false
          let nuevaCompra: number | null = null
          let nuevaVenta: number | null = null
          if (u.precioCompraNuevo != null && u.precioCompraNuevo !== current.precio_compra) {
            patch.precio_compra = u.precioCompraNuevo
            nuevaCompra = u.precioCompraNuevo
            cambia = true
          }
          if (u.precioVentaNuevo != null && u.precioVentaNuevo !== current.precio_venta) {
            patch.precio_venta = u.precioVentaNuevo
            nuevaVenta = u.precioVentaNuevo
            cambia = true
          }
          if (!cambia) return

          const { error: updErr } = await supabaseAdmin
            .from("inventario")
            .update(patch)
            .eq("id", u.id)
            .eq("organization_id", organizationId!)
          if (updErr) throw updErr

          updatedCount++
          historialRows.push({
            inventario_id: u.id,
            precio_compra_anterior: nuevaCompra != null ? current.precio_compra : null,
            precio_compra_nuevo: nuevaCompra,
            precio_venta_anterior: nuevaVenta != null ? current.precio_venta : null,
            precio_venta_nuevo: nuevaVenta,
            motivo: motivoFinal,
            usuario_id: userId ?? null,
            organization_id: organizationId!,
          })
        })
      )
    }

    if (historialRows.length > 0) {
      // chunk inserts to keep payload reasonable
      for (let i = 0; i < historialRows.length; i += 500) {
        const slice = historialRows.slice(i, i + 500)
        const { error: histErr } = await supabaseAdmin.from("historial_precios").insert(slice)
        if (histErr) {
          // do not fail the whole request — prices already updated; just log
          console.error("historial_precios insert error:", histErr)
          break
        }
      }
    }

    return NextResponse.json({ updated: updatedCount })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error executing precios import:", err)
    return NextResponse.json({ error: "Error al aplicar los cambios" }, { status: 500 })
  }
}
