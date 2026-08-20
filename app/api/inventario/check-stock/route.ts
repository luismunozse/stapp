import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import {
  getCookieSucursalId,
  resolveSucursalLectura,
  getDepositoDeSucursal,
  resolverDestinoVenta,
  derivarLecturaVenta,
} from "@/lib/sucursal"

// POST /api/inventario/check-stock?scope=venta  body: { ids: string[] }
// Returns the CURRENT available stock per inventory id, scoped to the caller's
// sucursal (per-deposito) the same way the barcode/search endpoints are — so a
// POS pre-checkout re-validation sees the real, up-to-the-second stock and can
// warn before submitting (the RPC enforces it atomically anyway, but this gives
// a clean UX instead of a post-submit error). Response: { stock: { [id]: number } }
// scope=venta (POS-only opt-in): ignores "ver todas" and always scopes stock to the
// sucursal/deposito the sale will actually draw from (same resolution as the ventas
// write path) — see app/api/inventario/search/route.ts for the full rationale.
export async function POST(request: Request) {
  try {
    const { error, organizationId, role, session } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const scopeVenta = searchParams.get("scope") === "venta"

    const body = await request.json().catch(() => ({}))
    const ids: string[] = Array.isArray(body?.ids)
      ? body.ids.filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
      : []

    if (ids.length === 0) {
      return NextResponse.json({ stock: {} })
    }
    const uniqueIds = Array.from(new Set(ids)).slice(0, 200)

    const cookieSucursalId = await getCookieSucursalId()
    const userSucursalId = session?.user?.sucursalId ?? null

    let sucursalId: string | null
    let verTodas: boolean
    let depositoIdPrefetched: string | null = null

    if (scopeVenta) {
      const destino = await resolverDestinoVenta({ role, organizationId: organizationId!, userSucursalId })
      const lectura = derivarLecturaVenta(destino)
      sucursalId = lectura.sucursalId
      depositoIdPrefetched = lectura.depositoId
      verTodas = lectura.verTodas
    } else {
      const resolved = resolveSucursalLectura({ role, userSucursalId, cookieSucursalId })
      sucursalId = resolved.sucursalId
      verTodas = resolved.verTodas
    }

    const stock: Record<string, number> = {}

    if (!verTodas && sucursalId) {
      // Per-sucursal: read stock from that sucursal's principal deposito.
      const depId = scopeVenta ? depositoIdPrefetched : await getDepositoDeSucursal(organizationId!, sucursalId)
      if (depId) {
        const { data, error: dbError } = await supabaseAdmin
          .from("inventario_depositos")
          .select("inventario_id, stock")
          .eq("deposito_id", depId)
          .in("inventario_id", uniqueIds)
        if (dbError) throw dbError
        for (const row of data || []) {
          stock[row.inventario_id] = row.stock ?? 0
        }
      }
      // Ids with no deposito row → 0 (filled in the normalization below).
    } else {
      // Aggregate stock (ADMIN ver todas).
      const { data, error: dbError } = await supabaseAdmin
        .from("inventario")
        .select("id, stock")
        .eq("organization_id", organizationId!)
        .is("deleted_at", null)
        .in("id", uniqueIds)
      if (dbError) throw dbError
      for (const row of data || []) {
        stock[row.id] = row.stock ?? 0
      }
    }

    // Normalize: every requested id present (missing → 0).
    for (const id of uniqueIds) {
      if (!(id in stock)) stock[id] = 0
    }

    return NextResponse.json({ stock })
  } catch (error) {
    console.error("Error checking stock:", error)
    return NextResponse.json({ error: "Error al verificar stock" }, { status: 500 })
  }
}
