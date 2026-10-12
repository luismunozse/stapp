import { NextResponse } from "next/server"
import { requireAdmin, requirePosAccess, requireCajaAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaEscritura, sucursalParaLectura } from "@/lib/sucursal"
import { z } from "zod"

const aperturaSchema = z.object({
  saldoInicial: z.number().min(0, "El saldo inicial no puede ser negativo"),
})

// GET - Obtener sesión actual o historial
//
// Un handler, dos permisos, porque son dos lecturas distintas con dos públicos
// distintos:
//
//   ?current=true  -> ¿hay caja abierta en mi sucursal? La pide el POS
//                     (components/pos/pos-terminal.tsx) para enganchar la venta
//                     a la sesión. Va por requirePosAccess: si la cerráramos
//                     detrás del permiso de caja, el vendedor no podría vender.
//
//   sin ?current   -> historial de sesiones CERRADAS. Es histórico financiero
//                     de la organización, del mismo lado del corte que el
//                     export CSV: requireAdmin.
//
// Antes las dos iban por requireAuth, así que cualquier rol autenticado leía
// el historial completo de cierres.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const current = searchParams.get("current")
    const desde = searchParams.get("desde")
    const hasta = searchParams.get("hasta")

    const { error, organizationId, role, session } =
      current === "true" ? await requirePosAccess() : await requireAdmin()
    if (error) return error

    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })

    if (current === "true") {
      let currentQuery = supabaseAdmin
        .from("sesiones_caja")
        .select("*, users!sesiones_caja_usuario_apertura_id_fkey(id, nombre)")
        .eq("organization_id", organizationId!)
        .eq("estado", "ABIERTA")
      if (!filtro.verTodas && filtro.sucursalId) {
        currentQuery = currentQuery.eq("sucursal_id", filtro.sucursalId)
      }
      const { data: sesion } = await currentQuery.maybeSingle()

      return NextResponse.json({
        sesion: sesion
          ? {
              id: sesion.id,
              estado: sesion.estado,
              fecha: sesion.fecha,
              saldoInicial: parseFloat(sesion.saldo_inicial),
              openedAt: sesion.opened_at,
              usuarioApertura: sesion.users
                ? { id: sesion.users.id, nombre: sesion.users.nombre }
                : null,
            }
          : null,
      })
    }

    // Historial de sesiones cerradas
    let query = supabaseAdmin
      .from("sesiones_caja")
      .select(`
        *,
        usuario_apertura:users!sesiones_caja_usuario_apertura_id_fkey(id, nombre),
        usuario_cierre:users!sesiones_caja_usuario_cierre_id_fkey(id, nombre)
      `)
      .eq("organization_id", organizationId!)
      .eq("estado", "CERRADA")
      .order("fecha", { ascending: false })

    if (!filtro.verTodas && filtro.sucursalId) {
      query = query.eq("sucursal_id", filtro.sucursalId)
    }

    if (desde) query = query.gte("fecha", desde)
    if (hasta) query = query.lte("fecha", hasta)

    query = query.limit(50)

    const { data: sesiones } = await query

    return NextResponse.json({
      sesiones: (sesiones || []).map((s) => ({
        id: s.id,
        estado: s.estado,
        fecha: s.fecha,
        saldoInicial: parseFloat(s.saldo_inicial || "0"),
        totalIngresos: s.total_ingresos ? parseFloat(s.total_ingresos) : null,
        totalEgresos: s.total_egresos ? parseFloat(s.total_egresos) : null,
        totalIngresosEfectivo: s.total_ingresos_efectivo ? parseFloat(s.total_ingresos_efectivo) : null,
        totalEgresosEfectivo: s.total_egresos_efectivo ? parseFloat(s.total_egresos_efectivo) : null,
        conteoFisico: s.conteo_fisico ? parseFloat(s.conteo_fisico) : null,
        diferencia: s.diferencia ? parseFloat(s.diferencia) : null,
        observacionesCierre: s.observaciones_cierre,
        usuarioApertura: s.usuario_apertura
          ? { id: s.usuario_apertura.id, nombre: s.usuario_apertura.nombre }
          : null,
        usuarioCierre: s.usuario_cierre
          ? { id: s.usuario_cierre.id, nombre: s.usuario_cierre.nombre }
          : null,
        openedAt: s.opened_at,
        closedAt: s.closed_at,
      })),
    })
  } catch (err) {
    console.error("Error fetching sesiones caja:", err)
    return NextResponse.json({ error: "Error al obtener sesiones" }, { status: 500 })
  }
}

// POST - Abrir nueva sesión de caja
export async function POST(request: Request) {
  try {
    const { error, organizationId, userId, role, session } = await requireCajaAccess()
    if (error) return error

    const body = await request.json()
    const parsed = aperturaSchema.parse(body)

    const sucursalId = await sucursalParaEscritura({
      role,
      organizationId: organizationId!,
      userSucursalId: session!.user.sucursalId ?? null,
    })

    // Verificar que no hay sesión abierta para esta sucursal
    const { data: existente } = await supabaseAdmin
      .from("sesiones_caja")
      .select("id")
      .eq("organization_id", organizationId!)
      .eq("estado", "ABIERTA")
      .eq("sucursal_id", sucursalId!)
      .maybeSingle()

    if (existente) {
      return NextResponse.json(
        { error: "Ya hay una sesión de caja abierta" },
        { status: 400 }
      )
    }

    const { data: sesion, error: insertError } = await supabaseAdmin
      .from("sesiones_caja")
      .insert({
        organization_id: organizationId!,
        sucursal_id: sucursalId,
        usuario_apertura_id: userId!,
        saldo_inicial: parsed.saldoInicial,
        estado: "ABIERTA",
        fecha: new Date().toISOString().split("T")[0],
      })
      .select("*")
      .single()

    if (insertError) {
      // El índice único parcial (idx_sesiones_caja_sucursal_abierta) puede
      // dispararse si el pre-check pasó pero otra request abrió la caja primero
      // (race / doble-click). Mapear a un 409 legible en vez de un 500 genérico.
      if (insertError.code === "23505") {
        return NextResponse.json(
          { error: "Ya hay una sesión de caja abierta" },
          { status: 409 }
        )
      }
      console.error("Error creating sesion:", insertError)
      return NextResponse.json({ error: "Error al abrir caja" }, { status: 500 })
    }

    return NextResponse.json({ sesion }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error opening caja:", err)
    return NextResponse.json({ error: "Error al abrir caja" }, { status: 500 })
  }
}
