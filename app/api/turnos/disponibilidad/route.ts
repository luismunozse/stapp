import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { dentroDeHorarioLaboral, type HorarioLaboral } from "@/lib/turnos/disponibilidad"

// GET ?tecnicoId=&inicio=ISO&fin=ISO&excludeTurnoId=
// Devuelve: { disponible, conflictos: [...], fueraDeHorario, razon? }
// No branch filter — tecnico availability is person-scoped, not branch-scoped.
// A tecnico cannot be double-booked regardless of which branch a turno belongs to.
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const tecnicoId = searchParams.get("tecnicoId")
    const inicioStr = searchParams.get("inicio")
    const finStr = searchParams.get("fin")
    const excludeTurnoId = searchParams.get("excludeTurnoId") || null

    if (!tecnicoId || !inicioStr) {
      return NextResponse.json(
        { error: "tecnicoId e inicio requeridos" },
        { status: 400 },
      )
    }
    const inicio = new Date(inicioStr)
    const fin = finStr ? new Date(finStr) : null
    if (Number.isNaN(inicio.getTime())) {
      return NextResponse.json({ error: "inicio inválido" }, { status: 400 })
    }

    // Cargar horario laboral
    const { data: tecnico } = await supabaseAdmin
      .from("users")
      .select("horario_laboral")
      .eq("id", tecnicoId)
      .eq("organization_id", organizationId!)
      .maybeSingle()

    const horario = (tecnico?.horario_laboral || null) as HorarioLaboral | null
    const horarioCheck = dentroDeHorarioLaboral(inicio, fin, horario)

    // Buscar conflictos: overlap con otros turnos del mismo técnico, no cancelados
    const finReal = fin || new Date(inicio.getTime() + 30 * 60 * 1000)
    let query = supabaseAdmin
      .from("turnos")
      .select("id, inicio, fin, tipo, estado, clientes (nombre)")
      .eq("organization_id", organizationId!)
      .eq("tecnico_id", tecnicoId)
      .not("estado", "in", "(cancelado,no_show)")
      // overlap: t.inicio < finReal && (t.fin || t.inicio + 30min) > inicio
      // Simplificamos: cargo todo el día y filtro en JS.
      .gte("inicio", new Date(inicio.getTime() - 24 * 3600 * 1000).toISOString())
      .lte("inicio", new Date(finReal.getTime() + 24 * 3600 * 1000).toISOString())

    if (excludeTurnoId) query = query.neq("id", excludeTurnoId)

    const { data: candidatos } = await query

    const conflictos = (candidatos || []).filter((c: any) => {
      const cIni = new Date(c.inicio).getTime()
      const cFin = c.fin
        ? new Date(c.fin).getTime()
        : cIni + 30 * 60 * 1000
      return cIni < finReal.getTime() && cFin > inicio.getTime()
    }).map((c: any) => ({
      id: c.id,
      inicio: c.inicio,
      fin: c.fin,
      tipo: c.tipo,
      estado: c.estado,
      clienteNombre: c.clientes?.nombre || null,
    }))

    return NextResponse.json({
      disponible: horarioCheck.ok && conflictos.length === 0,
      fueraDeHorario: !horarioCheck.ok,
      razonHorario: horarioCheck.razon,
      conflictos,
    })
  } catch (err) {
    console.error("Error checking disponibilidad:", err)
    return NextResponse.json({ error: "Error" }, { status: 500 })
  }
}
