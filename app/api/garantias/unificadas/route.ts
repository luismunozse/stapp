import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import {
  resolverAlcanceOrdenes,
  resolverAlcanceOrdenesDeSesion,
  type AlcanceOrdenes,
} from "@/lib/ordenes/alcance-lectura"
import { listarGarantias, parseFiltrosGarantias } from "@/lib/garantias/listado"

/**
 * GET /api/garantias/unificadas — garantías de reparación y de venta en una
 * sola lista (v_garantias, migración 400), con el conteo de cada pestaña.
 *
 * Query: tab (por-vencer | reclamos | vigentes | vencidas), origen (REPARACION
 * | VENTA), sucursal (solo ADMIN: "todas" o un id; sin él, el selector
 * global), q, page, limit, ventana (días "por vencer", default 7).
 *
 * Roles: ADMIN y VENDEDOR leen las dos clases; el TECNICO solo las de
 * reparación de su alcance y en solo lectura (ver lib/garantias/listado).
 */
export async function GET(request: Request) {
  try {
    const { error, organizationId, userId, role, session } = await requireAuth()
    if (error) return error

    const filtros = parseFiltrosGarantias(new URL(request.url).searchParams)

    // El ADMIN puede pedir una sucursal (o todas) por la URL: así el link del
    // dashboard, que cuenta toda la org, abre la misma lista. Para el resto
    // manda su sucursal, diga lo que diga la URL.
    let alcance: AlcanceOrdenes
    if (role === "ADMIN" && filtros.sucursal) {
      alcance =
        filtros.sucursal === "todas"
          ? { tipo: "todas" }
          : resolverAlcanceOrdenes({ role, sucursalId: filtros.sucursal, verTodas: false, userId })
    } else {
      alcance = await resolverAlcanceOrdenesDeSesion({
        role,
        userId,
        userSucursalId: session!.user.sucursalId ?? null,
      })
    }

    const r = await listarGarantias({
      organizationId: organizationId!,
      alcance,
      filtros,
      actor: { role, userId },
      conConteos: true,
    })

    return NextResponse.json({
      data: r.data,
      total: r.total,
      page: filtros.page,
      limit: filtros.limit,
      totalPages: Math.ceil(r.total / filtros.limit),
      conteos: r.conteos,
      hoy: r.hoy,
      ventana: r.ventana,
      sucursal: alcance.tipo === "todas" ? "todas" : alcance.sucursalId,
      soloLectura: role === "TECNICO",
    })
  } catch (err) {
    console.error("Error listando garantías:", err)
    return NextResponse.json({ error: "Error al obtener las garantías" }, { status: 500 })
  }
}
