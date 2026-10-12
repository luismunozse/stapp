import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * GET /api/usuarios — el equipo completo de la organizacion.
 *
 * No existia ninguna lectura que devolviera a todos juntos: `/api/tecnicos` y
 * `/api/vendedores` filtran cada una por su rol con un `.eq("rol", ...)` duro,
 * asi que un tecnico no aparece en la lista de vendedores ni al reves, y el
 * ADMIN de la organizacion no tenia forma de ver a su equipo en una sola
 * pantalla. Es lo que consume "Roles y permisos".
 *
 * Solo ADMIN: es la lista de quien puede que en el taller, con el correo de
 * cada uno. No devuelve `password` ni `refresh_token` — el SELECT es
 * explicito, nunca `*`, para que agregar una columna sensible a `users`
 * manana no la publique sola.
 */
export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { data, error: readError } = await supabaseAdmin
      .from("users")
      .select("id, nombre, email, rol, sucursal_id, activo, porcentaje_comision, created_at")
      .eq("organization_id", organizationId!)
      // ADMIN primero y despues alfabetico: la pantalla la abre un admin
      // buscando a alguien puntual, y quienes mandan van arriba.
      .order("rol", { ascending: true })
      .order("nombre", { ascending: true })

    if (readError) {
      console.error("Error leyendo el equipo de la organizacion:", readError)
      return NextResponse.json(
        { error: "No se pudo leer el equipo de la organización" },
        { status: 500 }
      )
    }

    return NextResponse.json(
      (data ?? []).map((u) => ({
        id: u.id,
        nombre: u.nombre,
        email: u.email,
        rol: u.rol,
        sucursalId: u.sucursal_id,
        // `activo` en esta tabla NO bloquea el login: solo saca al usuario de
        // los desplegables de asignacion (121_tecnicos_perfil_extendido.sql).
        // Quien bloquea el acceso es `email_verified`, que se maneja desde el
        // panel de superadmin. La pantalla tiene que decirlo con esas palabras
        // y no como "Activo/Inactivo" a secas, o promete algo que no hace.
        activo: u.activo !== false,
        porcentajeComision: u.porcentaje_comision ?? 0,
        createdAt: u.created_at,
      })),
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (err) {
    console.error("Error listando usuarios:", err)
    return NextResponse.json(
      { error: "No se pudo leer el equipo de la organización" },
      { status: 500 }
    )
  }
}
