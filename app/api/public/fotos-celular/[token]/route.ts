import { NextResponse } from "next/server"
import { z } from "zod"
import { supabaseAdmin } from "@/lib/supabase"
import { guardarFotoOrden } from "@/lib/fotos/guardar-foto-orden"
import { MIMES_FOTO_CELULAR, esTokenCargaValido, hashTokenCarga } from "@/lib/fotos/carga-sesion"

// Carga de fotos desde el celular con un enlace temporal (QR), sin login.
// El token es la única credencial: 256 bits, vence, se puede revocar y solo
// permite SUBIR fotos a una orden (no listar ni borrar nada).

const ENLACE_INVALIDO = "El enlace venció o ya no es válido. Generá uno nuevo desde la computadora."

const fotoSchema = z.object({
  data: z.string().min(1, "Imagen requerida"),
  mime: z.enum(MIMES_FOTO_CELULAR, { message: "Formato de imagen no admitido" }),
  descripcion: z.string().trim().max(200).optional(),
})

const enlaceInvalido = () => NextResponse.json({ error: ENLACE_INVALIDO }, { status: 404 })

// GET - Datos mínimos para la pantalla del celular: a qué orden se sube y cuánto queda.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    if (!esTokenCargaValido(token)) return enlaceInvalido()

    const { data: sesion } = await supabaseAdmin
      .from("foto_carga_sesiones")
      .select(`
        fotos_subidas, max_fotos, expires_at, revoked_at,
        ordenes_servicio ( codigo_orden, dispositivo ),
        organizations ( nombre, nombre_mostrar )
      `)
      .eq("token_hash", hashTokenCarga(token))
      .maybeSingle()

    if (!sesion || sesion.revoked_at || new Date(sesion.expires_at).getTime() <= Date.now()) {
      return enlaceInvalido()
    }

    const orden = sesion.ordenes_servicio as unknown as Record<string, unknown> | null
    const org = sesion.organizations as unknown as Record<string, unknown> | null

    return NextResponse.json({
      orden: {
        codigo: orden?.codigo_orden ?? null,
        dispositivo: orden?.dispositivo ?? null,
      },
      organizacion: org?.nombre_mostrar || org?.nombre || "",
      expiresAt: sesion.expires_at,
      fotosSubidas: sesion.fotos_subidas,
      maxFotos: sesion.max_fotos,
    })
  } catch (error) {
    console.error("Error leyendo sesión de carga de fotos:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}

// POST - Sube una foto a la orden del enlace.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  let sesionReservada: string | null = null
  try {
    const { token } = await params
    if (!esTokenCargaValido(token)) return enlaceInvalido()

    // Se valida el cuerpo antes de gastar cupo.
    const data = fotoSchema.parse(await request.json())

    // Reserva atómica: valida vigencia, revocación y tope en una sola sentencia.
    const { data: filas, error: rpcError } = await supabaseAdmin.rpc("reservar_foto_carga_sesion", {
      p_token_hash: hashTokenCarga(token),
    })
    if (rpcError) throw rpcError

    const sesion = Array.isArray(filas) ? filas[0] : filas
    if (!sesion) return enlaceInvalido()
    sesionReservada = sesion.id

    const guardada = await guardarFotoOrden({
      organizationId: sesion.organization_id,
      ordenId: sesion.orden_id,
      data: data.data,
      mime: data.mime,
      tipo: sesion.tipo,
      descripcion: data.descripcion,
    })

    if ("error" in guardada) {
      await liberar(sesion.id)
      sesionReservada = null
      return guardada.error
    }

    // No se devuelve la foto ni su URL: el enlace solo sirve para subir.
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (error) {
    if (sesionReservada) await liberar(sesionReservada)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
    }
    console.error("Error subiendo foto desde el celular:", error)
    return NextResponse.json({ error: "Error al subir la foto" }, { status: 500 })
  }
}

async function liberar(sesionId: string) {
  const { error } = await supabaseAdmin.rpc("liberar_foto_carga_sesion", { p_sesion_id: sesionId })
  if (error) console.error("Error liberando cupo de sesión de carga:", error)
}
