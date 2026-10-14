import { NextResponse } from "next/server"
import {
  requireAuth,
  requireInventarioAccess,
  hasInventarioAccess,
  resolveVendedoresHabilitados,
} from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatInventario } from "@/lib/db-utils"
import { isMissingColumnError } from "@/lib/db-errors"

type Contexto = { params: Promise<{ id: string }> }

const GRUPO_NO_ENCONTRADO = "Grupo no encontrado"

// While migration 355 (inventario_grupos, grupo_id, atributos) is not applied the
// group endpoints answer this instead of a 500; the form turns it into a disabled switch.
function migracionPendiente() {
  return NextResponse.json(
    { error: "Variantes todavía no está disponible", code: "MIGRACION_PENDIENTE" },
    { status: 503 }
  )
}

// A role without cost access gets NO precioCompra key (not even null): formatInventario
// emits `precioCompra: null` for it, which this endpoint drops.
function formatHijo(row: unknown, canViewCost: boolean) {
  const { precioCompra, ...resto } = formatInventario(row, canViewCost)!
  return canViewCost ? { ...resto, precioCompra } : resto
}

export async function GET(_request: Request, { params }: Contexto) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { data: grupo, error: grupoError } = await supabaseAdmin
      .from("inventario_grupos")
      .select("id, nombre, opciones")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .maybeSingle()

    if (grupoError) {
      if (isMissingColumnError(grupoError)) return migracionPendiente()
      throw grupoError
    }
    // Another organization's group looks exactly like a missing one.
    if (!grupo) return NextResponse.json({ error: GRUPO_NO_ENCONTRADO }, { status: 404 })

    // Active and archived children in one query, split below. Oldest first, ties by id:
    // the children of one RPC save share created_at (the transaction NOW()), so within a
    // save the order is by id, not creation order. The form lays the rows out from the
    // group options, not from this order.
    const { data: hijos, error: hijosError } = await supabaseAdmin
      .from("inventario")
      .select("*, proveedores:proveedor_id(id, nombre)")
      .eq("grupo_id", id)
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })

    if (hijosError) {
      if (isMissingColumnError(hijosError)) return migracionPendiente()
      throw hijosError
    }

    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

    const filas = hijos ?? []
    return NextResponse.json({
      grupo,
      variantes: filas.filter((h) => !h.deleted_at).map((h) => formatHijo(h, canViewCost)),
      archivadas: filas
        .filter((h) => h.deleted_at)
        .map((h) => ({ id: h.id, atributos: h.atributos ?? null, stock: h.stock })),
    })
  } catch (error) {
    console.error("Error fetching grupo de variantes:", error)
    return NextResponse.json({ error: "Error al obtener el grupo" }, { status: 500 })
  }
}

// Ungroup. Only the group row is deleted: the BEFORE DELETE trigger of the group clears
// `atributos` on its children and the composite foreign key frees `grupo_id`, in the
// same statement. Names, prices, stock, codes and each child's own photo stay as they are.
export async function DELETE(_request: Request, { params }: Contexto) {
  try {
    const { error, organizationId } = await requireInventarioAccess()
    if (error) return error

    const { id } = await params

    const { data, error: dbError } = await supabaseAdmin
      .from("inventario_grupos")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select("id")

    if (dbError) {
      if (isMissingColumnError(dbError)) return migracionPendiente()
      throw dbError
    }
    // Nothing deleted: unknown id, another organization's group, or already ungrouped.
    if (!data || data.length === 0) {
      return NextResponse.json({ error: GRUPO_NO_ENCONTRADO }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error ungrouping variantes:", error)
    return NextResponse.json({ error: "Error al desagrupar las variantes" }, { status: 500 })
  }
}
