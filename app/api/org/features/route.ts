import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { isMissingColumnError } from "@/lib/db-errors"

// Lectura pública (cualquier rol autenticado) de feature flags por org.
// Se usa desde el sidebar/nav para mostrar/ocultar módulos opcionales.
export async function GET() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { data, error: readError } = await supabaseAdmin
      .from("organizations")
      .select("modulo_agenda, vendedores_administran_inventario")
      .eq("id", organizationId!)
      .single()

    // "No pude leer" no es "el flag está apagado". Devolver los flags en false
    // ante un error de lectura es una denegación fabricada, y del otro lado del
    // cable la página de inventario saca al vendedor de la pantalla con lo que
    // tenga escrito en el formulario. Un 503 lo dice como lo que es: el navbar
    // ya trata !r.ok como "me quedo con lo que tenía".
    //
    // Pero "no hay fila" SÍ es una respuesta, y es la que hay que dar. `.single()`
    // devuelve PGRST116 cuando no matchea nada; meterlo en la misma bolsa que un
    // error de transporte lo vuelve un 503 permanente, y ahí el vendedor queda
    // clavado en "no se pudo verificar" con un reintento que no puede tener
    // éxito nunca, más el navbar escondiendo los módulos opcionales sin
    // recuperación. Sin fila no hay módulos habilitados: eso es fail-closed y es
    // lo que esta ruta contestaba antes.
    //
    // Lo mismo, por el mismo motivo, con una columna que todavía no existe. En
    // este proyecto las migraciones se aplican A MANO y después del merge, así
    // que siempre hay una ventana en la que el deploy va adelante de su
    // migración: eso solía degradar —el módulo opcional quedaba oculto y la app
    // andaba— y como 503 clavaría a todo VENDEDOR en "no se pudo verificar"
    // hasta que alguien corra la migración. Una columna ausente es una
    // respuesta: la feature todavía no está.
    const respuestaSinDatos =
      readError?.code === "PGRST116" || isMissingColumnError(readError)
    if (!respuestaSinDatos && (readError || !data)) {
      console.error("Error reading org features:", readError)
      return NextResponse.json(
        { error: "No se pudieron leer los módulos de la organización" },
        { status: 503 },
      )
    }

    return NextResponse.json(
      {
        moduloAgenda: !!data?.modulo_agenda,
        vendedoresAdministranInventario: !!data?.vendedores_administran_inventario,
      },
      {
        headers: {
          "Cache-Control": "private, max-age=60",
        },
      },
    )
  } catch (err) {
    console.error("Error fetching org features:", err)
    // Mismo criterio que arriba: una excepción tampoco puede pasar por un "no".
    return NextResponse.json(
      { error: "No se pudieron leer los módulos de la organización" },
      { status: 503 },
    )
  }
}
