import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { inscripcionSchema, toInscripcion } from "@/lib/android-beta"

const NO_STORE = { "Cache-Control": "no-store" }

// Cualquier usuario autenticado, sea cual sea su rol: la beta es una cuestion
// de la persona (su celular, su cuenta de Google), no del taller. Por eso no hay
// guard de rol y la ruta no esta en ninguna lista de lib/rutas-por-rol.ts.

// GET /api/beta-android: la inscripcion del usuario de la sesion, o null.
export async function GET() {
  const { error, userId } = await requireAuth()
  if (error) return error

  const { data, error: dbError } = await supabaseAdmin
    .from("android_beta_testers")
    .select("email, estado")
    .eq("user_id", userId!)
    .maybeSingle()

  // Nunca adivinar: un error de lectura no puede pasar por "todavia no se anoto".
  if (dbError) {
    console.error("[beta-android] GET", dbError)
    return NextResponse.json({ error: "No pudimos leer tu inscripción" }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ inscripcion: data ? toInscripcion(data) : null }, { headers: NO_STORE })
}

// POST /api/beta-android { email }: anota al usuario, o le cambia el correo.
export async function POST(request: Request) {
  const { error, userId, organizationId } = await requireAuth()
  if (error) return error

  const parsed = await safeParseBody(request, inscripcionSchema)
  if ("error" in parsed) return parsed.error
  const { email } = parsed.data

  const { data: existente, error: readError } = await supabaseAdmin
    .from("android_beta_testers")
    .select("email, estado")
    .eq("user_id", userId!)
    .maybeSingle()

  if (readError) {
    console.error("[beta-android] POST read", readError)
    return NextResponse.json({ error: "No pudimos guardar tu inscripción" }, { status: 500, headers: NO_STORE })
  }

  // Un AGREGADO con el mismo correo no retrocede: ya esta en la lista de Play y
  // reenviar el formulario no puede sacarle la invitacion. Con otro correo si
  // vuelve a PENDIENTE: el nuevo todavia no esta en Play. Un DESCARTADO que se
  // vuelve a anotar tambien vuelve a la cola.
  const sigueAgregado = existente?.estado === "AGREGADO" && existente.email === email
  const payload: Record<string, unknown> = {
    user_id: userId!,
    organization_id: organizationId!,
    email,
  }
  if (!sigueAgregado) {
    payload.estado = "PENDIENTE"
    payload.agregado_at = null
  }

  // Upsert por user_id (UNIQUE): dos envios seguidos no chocan con el unique.
  const { data: guardada, error: writeError } = await supabaseAdmin
    .from("android_beta_testers")
    .upsert(payload, { onConflict: "user_id" })
    .select("email, estado")
    .single()

  if (writeError || !guardada) {
    console.error("[beta-android] POST write", writeError)
    return NextResponse.json({ error: "No pudimos guardar tu inscripción" }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ inscripcion: toInscripcion(guardada) }, { headers: NO_STORE })
}
