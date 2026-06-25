import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"
import { notifyTurno } from "@/lib/turnos/notifications"
import { sucursalParaLectura, sucursalParaEscritura } from "@/lib/sucursal"
import { zonedTimeToUtc, DEFAULT_TIMEZONE } from "@/lib/timezone"

const clienteSnapshotSchema = z.object({
  nombre: z.string().min(1),
  telefono: z.string().min(1),
  email: z.string().email().nullable().optional(),
  direccion: z.string().nullable().optional(),
  dni: z.string().nullable().optional(),
})

const recurrenciaSchema = z.object({
  frecuencia: z.enum(["diaria", "semanal", "mensual"]),
  intervalo: z.number().int().min(1).max(12),
  total: z.number().int().min(2).max(52),
})

const turnoCreateSchema = z.object({
  clienteId: z.string().min(1).optional(),
  clienteSnapshot: clienteSnapshotSchema.optional(),
  tecnicoId: z.string().min(1).optional(),
  inicio: z.string().datetime(),
  fin: z.string().datetime().optional(),
  direccion: z.string().optional(),
  tipo: z.enum([
    "visita_diagnostico",
    "reparacion_onsite",
    "retiro",
    "entrega",
    "mantenimiento",
  ]).default("visita_diagnostico"),
  tipoDispositivo: z.string().optional(),
  marca: z.string().optional(),
  modelo: z.string().optional(),
  problemaReportado: z.string().optional(),
  fotosPrevias: z.array(z.string()).optional(),
  notas: z.string().optional(),
  recurrencia: recurrenciaSchema.optional(),
}).refine(
  (d) => d.clienteId || d.clienteSnapshot,
  { message: "Debe indicar clienteId o clienteSnapshot" },
)

export function generarFechasRecurrencia(
  inicio: Date,
  fin: Date | null,
  rec: { frecuencia: "diaria" | "semanal" | "mensual"; intervalo: number; total: number } | undefined,
): Array<{ inicio: Date; fin: Date | null }> {
  if (!rec) return [{ inicio, fin }]
  const out: Array<{ inicio: Date; fin: Date | null }> = []
  const duracionMs = fin ? fin.getTime() - inicio.getTime() : 0
  for (let i = 0; i < rec.total; i++) {
    const next = new Date(inicio)
    if (rec.frecuencia === "diaria") {
      next.setDate(next.getDate() + i * rec.intervalo)
    } else if (rec.frecuencia === "semanal") {
      next.setDate(next.getDate() + i * 7 * rec.intervalo)
    } else if (rec.frecuencia === "mensual") {
      const originalDay = inicio.getDate()
      next.setDate(1)                          // avoid overflow while setting month
      next.setMonth(next.getMonth() + i * rec.intervalo)
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
      next.setDate(Math.min(originalDay, lastDay))
      // Restore time-of-day (safety belt)
      next.setHours(inicio.getHours(), inicio.getMinutes(), inicio.getSeconds(), inicio.getMilliseconds())
    }
    out.push({
      inicio: next,
      fin: duracionMs > 0 ? new Date(next.getTime() + duracionMs) : null,
    })
  }
  return out
}

function formatTurno(t: any) {
  return {
    id: t.id,
    organizationId: t.organization_id,
    clienteId: t.cliente_id,
    clienteSnapshot: t.cliente_snapshot,
    tecnicoId: t.tecnico_id,
    inicio: t.inicio,
    fin: t.fin,
    direccion: t.direccion,
    tipo: t.tipo,
    tipoDispositivo: t.tipo_dispositivo,
    marca: t.marca,
    modelo: t.modelo,
    problemaReportado: t.problema_reportado,
    fotosPrevias: t.fotos_previas || [],
    estado: t.estado,
    ordenId: t.orden_id,
    notas: t.notas,
    createdBy: t.created_by,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    cliente: t.clientes
      ? { id: t.clientes.id, nombre: t.clientes.nombre, telefono: t.clientes.telefono }
      : null,
    tecnico: t.users
      ? { id: t.users.id, nombre: t.users.nombre }
      : null,
    orden: t.ordenes_servicio
      ? {
          id: t.ordenes_servicio.id,
          numeroOrden: t.ordenes_servicio.numero_orden,
          codigoOrden: t.ordenes_servicio.codigo_orden,
        }
      : null,
  }
}

export async function GET(request: Request) {
  try {
    const { error, organizationId, userId, role, session } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const desde = searchParams.get("desde") || ""
    const hasta = searchParams.get("hasta") || ""
    const tecnicoId = searchParams.get("tecnicoId") || ""
    const estado = searchParams.get("estado") || ""
    const conOrden = searchParams.get("conOrden") || ""

    const [lectura, { data: orgRow }] = await Promise.all([
      sucursalParaLectura({
        role,
        userSucursalId: session!.user.sucursalId ?? null,
      }),
      supabaseAdmin
        .from("organizations")
        .select("zona_horaria")
        .eq("id", organizationId!)
        .maybeSingle(),
    ])

    const timeZone: string = (orgRow as any)?.zona_horaria || DEFAULT_TIMEZONE

    let query = supabaseAdmin
      .from("turnos")
      .select(`
        *,
        clientes (id, nombre, telefono),
        users:tecnico_id (id, nombre),
        ordenes_servicio:orden_id (id, numero_orden, codigo_orden)
      `)
      .eq("organization_id", organizationId!)
      .order("inicio", { ascending: true })

    if (role === "TECNICO") {
      query = query.eq("tecnico_id", userId!)
    } else if (tecnicoId) {
      query = query.eq("tecnico_id", tecnicoId)
    }

    // Branch filter — additive with the existing TECNICO filter above
    if (!lectura.verTodas && lectura.sucursalId) {
      query = query.eq("sucursal_id", lectura.sucursalId)
    }
    if (estado) query = query.eq("estado", estado)
    if (conOrden === "sin") query = query.is("orden_id", null)
    if (conOrden === "con") query = query.not("orden_id", "is", null)

    // Date-range filter using org timezone — converts wall-clock bounds to UTC instants
    if (desde) {
      const [dy, dm, dd] = desde.split("-").map(Number)
      const desdeUtc = zonedTimeToUtc(dy, dm, dd, 0, 0, 0, timeZone).toISOString()
      query = query.gte("inicio", desdeUtc)
    }
    if (hasta) {
      const [hy, hm, hd] = hasta.split("-").map(Number)
      const hastaUtc = zonedTimeToUtc(hy, hm, hd, 23, 59, 59, timeZone).toISOString()
      query = query.lte("inicio", hastaUtc)
    }

    const { data, error: dbError } = await query
    if (dbError) throw dbError

    return NextResponse.json({
      turnos: (data || []).map(formatTurno),
    })
  } catch (err) {
    console.error("Error fetching turnos:", err)
    return NextResponse.json({ error: "Error al obtener turnos" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId, role, session } = await requireAuth()
    if (error) return error

    // Resolve branch for write stamping
    const sucursalId = await sucursalParaEscritura({
      role,
      organizationId: organizationId!,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    if (!sucursalId) {
      return NextResponse.json(
        { error: "La organización no tiene una sucursal principal configurada" },
        { status: 500 },
      )
    }

    // Verificar módulo agenda activo
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("modulo_agenda")
      .eq("id", organizationId!)
      .single()
    if (!org?.modulo_agenda) {
      return NextResponse.json(
        { error: "Módulo de agenda no activado para esta organización" },
        { status: 403 },
      )
    }

    const body = await request.json()
    const data = turnoCreateSchema.parse(body)

    // Si rol TECNICO, sólo se puede asignar a sí mismo
    let tecnicoAsignadoId: string | null = null
    if (role === "TECNICO") {
      tecnicoAsignadoId = userId!
    } else if (data.tecnicoId) {
      const { data: tecnicoCheck } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("id", data.tecnicoId)
        .eq("organization_id", organizationId!)
        .in("rol", ["TECNICO", "ADMIN"])
        .maybeSingle()
      if (!tecnicoCheck) {
        return NextResponse.json({ error: "Técnico inválido" }, { status: 400 })
      }
      tecnicoAsignadoId = data.tecnicoId
    }

    // Validar cliente si se pasó
    if (data.clienteId) {
      const { data: clienteCheck } = await supabaseAdmin
        .from("clientes")
        .select("id")
        .eq("id", data.clienteId)
        .eq("organization_id", organizationId!)
        .maybeSingle()
      if (!clienteCheck) {
        return NextResponse.json({ error: "Cliente inválido" }, { status: 400 })
      }
    }

    // Generar lista de fechas (1 si no hay recurrencia, N si sí)
    const fechas = generarFechasRecurrencia(
      new Date(data.inicio),
      data.fin ? new Date(data.fin) : null,
      data.recurrencia,
    )
    const serieId = data.recurrencia ? crypto.randomUUID() : null

    const rows = fechas.map((f, idx) => ({
      organization_id: organizationId!,
      sucursal_id: sucursalId,
      cliente_id: data.clienteId || null,
      cliente_snapshot: data.clienteSnapshot || null,
      tecnico_id: tecnicoAsignadoId,
      inicio: f.inicio.toISOString(),
      fin: f.fin ? f.fin.toISOString() : null,
      direccion: data.direccion || null,
      tipo: data.tipo,
      tipo_dispositivo: data.tipoDispositivo || null,
      marca: data.marca || null,
      modelo: data.modelo || null,
      problema_reportado: data.problemaReportado || null,
      fotos_previas: data.fotosPrevias || [],
      notas: data.notas || null,
      created_by: userId!,
      serie_id: serieId,
      // Sólo la primera fila guarda la config completa de recurrencia
      recurrencia: idx === 0 && data.recurrencia ? data.recurrencia : null,
    }))

    // ── Overlap pre-check (app-layer) ────────────────────────────────────────
    // Before inserting, verify the técnico has no active turnos overlapping
    // any of the new rows. We check the widest window: min(inicio) to max(fin).
    // This avoids N queries for recurrence series.
    if (tecnicoAsignadoId) {
      const ESTADOS_TERMINALES = ["cancelado", "no_show"]
      const rangeInicio = rows[0].inicio
      const rangeFin = rows[rows.length - 1].fin ?? rows[rows.length - 1].inicio

      const { data: conflictos } = await supabaseAdmin
        .from("turnos")
        .select("id, inicio, fin, estado")
        .eq("organization_id", organizationId!)
        .eq("tecnico_id", tecnicoAsignadoId)
        .not("estado", "in", `(${ESTADOS_TERMINALES.join(",")})`)
        .lt("inicio", rangeFin)
        .gt("fin", rangeInicio)

      if (conflictos && conflictos.length > 0) {
        const c = conflictos[0]
        const fechaConflicto = new Date(c.inicio).toLocaleString("es-AR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
        return NextResponse.json(
          { error: `El técnico ya tiene un turno en ese horario (${fechaConflicto})` },
          { status: 409 },
        )
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const { data: insertados, error: dbError } = await supabaseAdmin
      .from("turnos")
      .insert(rows)
      .select(`
        *,
        clientes (id, nombre, telefono),
        users:tecnico_id (id, nombre),
        ordenes_servicio:orden_id (id, numero_orden, codigo_orden)
      `)

    // Catch Postgres exclusion_violation (DB-layer safety net)
    if (dbError && (dbError as any).code === "23P01") {
      return NextResponse.json(
        { error: "El técnico ya tiene un turno en ese horario" },
        { status: 409 },
      )
    }
    if (dbError) throw dbError
    if (!insertados || insertados.length === 0) {
      throw new Error("No se pudo crear el turno")
    }

    const turno = insertados[0]

    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.create("turnos", turno.id, {
      inicio: turno.inicio,
      tecnico_id: turno.tecnico_id,
      cliente_id: turno.cliente_id,
      tipo: turno.tipo,
      serie_total: insertados.length,
    })

    // Notificación de confirmación al cliente (fire-and-forget)
    // Para series sólo se notifica el primer turno; los recordatorios
    // 24h cubren los demás.
    notifyTurno(turno.id, "confirmacion").catch((e) => {
      console.error("Error notifying turno confirmacion:", e)
    })

    return NextResponse.json(
      {
        ...formatTurno(turno),
        serieTotal: insertados.length,
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating turno:", err)
    return NextResponse.json({ error: "Error al crear turno" }, { status: 500 })
  }
}
