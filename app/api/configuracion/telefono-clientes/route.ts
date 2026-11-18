import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { isMissingColumnError } from "@/lib/db-errors"
import { leerTecnicosVenTelefonoClientes } from "@/lib/telefono-cliente"

/**
 * Permiso "los técnicos ven el teléfono de los clientes" (migración 416).
 *
 * Vive en su propia ruta y no en /api/configuracion: aquella lee y escribe todas las columnas
 * de la organización en una cascada de reintentos por migración pendiente, y sumarle una
 * columna más la alarga para todos. Este permiso es una columna, una consulta.
 *
 * `disponible: false` = la columna todavía no existe (migración sin aplicar): la pantalla de
 * permisos no lo dibuja.
 */
export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const valor = await leerTecnicosVenTelefonoClientes(organizationId!)
    return NextResponse.json(
      valor === undefined ? { disponible: false } : { disponible: true, tecnicosVenTelefonoClientes: valor },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (e) {
    console.error("Error leyendo tecnicos_ven_telefono_clientes:", e)
    return NextResponse.json({ error: "No se pudo leer el permiso" }, { status: 500 })
  }
}

const cuerpo = z.object({ tecnicosVenTelefonoClientes: z.boolean() })

export async function PUT(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const datos = cuerpo.safeParse(await request.json().catch(() => null))
    if (!datos.success) {
      return NextResponse.json({ error: "Valor inválido" }, { status: 400 })
    }

    const { error: dbError } = await supabaseAdmin
      .from("organizations")
      .update({ tecnicos_ven_telefono_clientes: datos.data.tecnicosVenTelefonoClientes })
      .eq("id", organizationId!)

    if (dbError) {
      if (isMissingColumnError(dbError)) {
        return NextResponse.json(
          { error: "Este permiso todavía no está disponible. Probá de nuevo en unos minutos." },
          { status: 409 }
        )
      }
      throw dbError
    }

    return NextResponse.json({ disponible: true, tecnicosVenTelefonoClientes: datos.data.tecnicosVenTelefonoClientes })
  } catch (e) {
    console.error("Error guardando tecnicos_ven_telefono_clientes:", e)
    return NextResponse.json({ error: "No se pudo guardar el permiso" }, { status: 500 })
  }
}
