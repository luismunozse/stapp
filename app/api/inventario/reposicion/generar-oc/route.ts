import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const itemSchema = z.object({
  inventarioId: z.string().min(1),
  cantidad: z.number().int().positive(),
  precioUnitario: z.number().min(0),
  descripcion: z.string().min(1).max(500),
})

const grupoSchema = z.object({
  proveedorId: z.string().min(1).nullable(),
  fechaRecepcionEsperada: z.string().nullable().optional(),
  notas: z.string().max(1000).nullable().optional(),
  items: z.array(itemSchema).min(1),
})

const schema = z.object({
  grupos: z.array(grupoSchema).min(1),
})

// POST /api/inventario/reposicion/generar-oc
// Crea N OCs en BORRADOR (1 por grupo). Items con proveedorId=null van a
// un grupo "sin proveedor" — OC sin proveedor_id, queda como borrador
// para que el usuario asigne.
//
// Devuelve lista de OCs creadas con su id + numero.
export async function POST(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const data = schema.parse(body)

    const ocsCreadas: Array<{ id: string; numeroOC: string; proveedorId: string | null; totalItems: number; total: number }> = []
    const errores: Array<{ proveedorId: string | null; error: string }> = []

    for (const grupo of data.grupos) {
      try {
        const items = grupo.items.map((it) => ({
          ...it,
          subtotal: it.cantidad * it.precioUnitario,
        }))
        const subtotal = items.reduce((s, i) => s + i.subtotal, 0)

        const { data: numeroOC, error: numErr } = await supabaseAdmin.rpc("get_next_oc_number", {
          p_org_id: organizationId!,
        })
        if (numErr) throw numErr

        const { data: oc, error: ocErr } = await supabaseAdmin
          .from("ordenes_compra")
          .insert({
            organization_id: organizationId!,
            proveedor_id: grupo.proveedorId,
            numero_oc: numeroOC,
            estado: "BORRADOR",
            fecha_recepcion_esperada: grupo.fechaRecepcionEsperada || null,
            notas: grupo.notas || "Generada desde sugerencias de reposición",
            subtotal,
            total: subtotal,
            created_by: userId,
          })
          .select("*")
          .single()

        if (ocErr) throw ocErr

        const { error: itemsErr } = await supabaseAdmin.from("items_orden_compra").insert(
          items.map((it) => ({
            orden_compra_id: oc.id,
            descripcion: it.descripcion,
            inventario_id: it.inventarioId,
            cantidad_pedida: it.cantidad,
            precio_unitario: it.precioUnitario,
            subtotal: it.subtotal,
          }))
        )

        if (itemsErr) {
          await supabaseAdmin.from("ordenes_compra").delete().eq("id", oc.id)
          throw itemsErr
        }

        ocsCreadas.push({
          id: oc.id,
          numeroOC: oc.numero_oc,
          proveedorId: grupo.proveedorId,
          totalItems: items.length,
          total: subtotal,
        })
      } catch (e) {
        errores.push({
          proveedorId: grupo.proveedorId,
          error: e instanceof Error ? e.message : "Error desconocido",
        })
      }
    }

    return NextResponse.json(
      {
        creadas: ocsCreadas.length,
        errores: errores.length,
        ocs: ocsCreadas,
        errors: errores,
      },
      { status: errores.length === 0 ? 201 : 207 }
    )
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error generating OCs from reposicion:", err)
    return NextResponse.json({ error: "Error al generar OCs" }, { status: 500 })
  }
}
