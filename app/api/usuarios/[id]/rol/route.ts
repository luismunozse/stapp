import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-utils"
import { invalidateRefreshToken } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { getPrincipalId } from "@/lib/sucursal"
import { enforcePlanLimit, isPlanLimitError, planLimitErrorResponse } from "@/lib/plan-limits"

// Los tres valores del enum `user_role` (001_schema.sql:5). No hay mas: no
// existe ningun ALTER TYPE que lo amplie en toda la carpeta de migraciones.
const cambioRolSchema = z.object({
  rol: z.enum(["ADMIN", "TECNICO", "VENDEDOR"]),
  // Se exige mas abajo, solo cuando el rol destino cobra comision. Aca es
  // opcional para poder devolver un 400 con un mensaje que explique por que,
  // en vez del error de Zod.
  porcentajeComision: z.number().min(0).max(100).optional(),
})

// Roles cuya comision sale de `users.porcentaje_comision`. El ADMIN no cobra
// comision, asi que pasar a ADMIN no pide el numero.
const ROLES_CON_COMISION = new Set(["TECNICO", "VENDEDOR"])

// El tipo de limite de plan que consume cada rol. El ADMIN no consume cupo.
const LIMITE_POR_ROL: Record<string, "tecnicos" | "vendedores" | null> = {
  TECNICO: "tecnicos",
  VENDEDOR: "vendedores",
  ADMIN: null,
}

/**
 * PATCH /api/usuarios/[id]/rol — cambiar el rol de un usuario de la organizacion.
 *
 * Hasta acá el rol se fijaba al crear el usuario y no habia forma de moverlo:
 * `/api/tecnicos` y `/api/vendedores` insertan un literal y sus PUT ni
 * siquiera aceptan el campo. Lo unico que podia cambiarlo era
 * `/api/superadmin/users/[userId]/change-role`, que es herramienta de
 * plataforma y ningun taller ve.
 *
 * Este es su equivalente para el ADMIN del taller. Comparte con aquel la
 * reconciliacion de `sucursal_id` —sin ella rebota el CHECK de la 241— y suma
 * los guards que un superadmin no necesita porque opera desde afuera de la
 * organizacion.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const parsed = await safeParseBody(request, cambioRolSchema)
    if ("error" in parsed) return parsed.error
    const { rol, porcentajeComision } = parsed.data

    // Guard 1: nadie se cambia el rol a si mismo.
    //
    // Va ANTES de leer la fila a proposito: no depende de nada de la BD, y es
    // el unico caso en el que el ADMIN se deja afuera de forma irreversible —
    // al dejar de ser ADMIN pierde esta misma pantalla, y ya no hay como
    // volver salvo por soporte.
    if (id === userId) {
      return NextResponse.json(
        { error: "No podés cambiarte el rol a vos mismo. Pediselo a otro administrador." },
        { status: 400 }
      )
    }

    const { data: usuario, error: readError } = await supabaseAdmin
      .from("users")
      .select("id, nombre, rol, organization_id, sucursal_id, porcentaje_comision")
      .eq("id", id)
      .single()

    // El filtro por organizacion es del lado del server y no del query a
    // proposito: `.eq("organization_id", ...)` daria el mismo 404, pero asi el
    // caso queda explicito y no se pierde en un WHERE si alguien toca el
    // select. Un usuario de otra organizacion es "no existe", nunca un 403:
    // un 403 confirmaria que el id existe en algun lado.
    if (readError || !usuario || usuario.organization_id !== organizationId) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
    }

    const rolAnterior = usuario.rol

    if (rolAnterior === rol) {
      return NextResponse.json(
        { error: `${usuario.nombre} ya tiene el rol ${rol}.` },
        { status: 400 }
      )
    }

    // Guard 2: la organizacion no puede quedarse sin ADMIN.
    //
    // Degradar al ultimo deja al taller sin nadie que entre a Configuracion —
    // ni a esta pantalla, que es lo que haria falta para deshacerlo. Se cuenta
    // excluyendo al que se esta por degradar: lo que importa es cuantos
    // QUEDAN, no cuantos hay.
    if (rolAnterior === "ADMIN") {
      const { count, error: countError } = await supabaseAdmin
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId!)
        .eq("rol", "ADMIN")
        .neq("id", id)

      // Fail-closed: si no se pudo contar, no se degrada. Dejar al taller sin
      // ADMIN por una lectura fallida no se arregla desde la app.
      if (countError || (count ?? 0) < 1) {
        return NextResponse.json(
          {
            error:
              "No podés cambiarle el rol al único administrador de la organización. Nombrá a otro administrador primero.",
          },
          { status: 400 }
        )
      }
    }

    // Guard 3: el % de comision se re-confirma al entrar a un rol que la cobra.
    //
    // `users.porcentaje_comision` es UNA sola columna, compartida entre la
    // comision de reparacion del tecnico y la de venta del vendedor
    // (122_comisiones_vendedores.sql:6). Sin este pedido, un tecnico al 15%
    // que pasa a vendedor arranca cobrando 15% sobre cada venta sin que nadie
    // lo haya decidido: la base de calculo cambia por completo y el numero se
    // queda igual.
    if (ROLES_CON_COMISION.has(rol) && porcentajeComision === undefined) {
      return NextResponse.json(
        {
          error:
            "Confirmá el porcentaje de comisión para el rol nuevo: la comisión de reparación y la de venta comparten el mismo campo.",
          code: "COMISION_REQUERIDA",
          porcentajeActual: usuario.porcentaje_comision ?? 0,
        },
        { status: 400 }
      )
    }

    // Guard 4: el cupo del plan.
    //
    // Pre-chequeo para dar el mensaje bueno con el CTA de upgrade. No es la
    // autoridad: entre esto y el UPDATE puede entrar un alta, y quien decide
    // de verdad es el trigger de la migracion 323 (ver mas abajo). Sin este
    // endpoint el cambio de rol seria la puerta de atras al limite del plan.
    const limite = LIMITE_POR_ROL[rol]
    if (limite) {
      const limitError = await enforcePlanLimit(organizationId!, limite)
      if (limitError) return limitError
    }

    const updates: Record<string, unknown> = { rol }

    // Reconciliacion de sucursal, igual que en el endpoint de superadmin: el
    // CHECK de la 241 exige `rol = 'ADMIN' OR sucursal_id IS NOT NULL`.
    if (rol === "ADMIN") {
      updates.sucursal_id = null
    } else if (usuario.sucursal_id === null) {
      const principalId = await getPrincipalId(organizationId!)
      if (!principalId) {
        return NextResponse.json(
          { error: "La organización no tiene sucursal principal configurada" },
          { status: 400 }
        )
      }
      updates.sucursal_id = principalId
    }
    // else: no-admin que ya tiene sucursal — se queda en la suya.

    if (ROLES_CON_COMISION.has(rol)) {
      updates.porcentaje_comision = porcentajeComision
    }
    // Pasar a ADMIN no toca `porcentaje_comision`: el ADMIN no cobra, y
    // pisarlo perderia el numero si mañana vuelve a un rol que si cobra.

    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update(updates)
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (updateError) {
      // Backstop atomico del cupo: desde la 323 el trigger de tecnicos_count
      // corre tambien en UPDATE y levanta PLAN_LIMIT_EXCEEDED. El pre-chequeo
      // de arriba puede haber pasado y este no.
      if (isPlanLimitError(updateError)) {
        return planLimitErrorResponse(updateError)
      }
      throw updateError
    }

    // Guard 5: cortarle la sesion al usuario tocado.
    //
    // `token.role` se firma en el JWT al iniciar sesion y NO se vuelve a leer:
    // el refresh de lib/auth.ts solo re-sincroniza nombre y avatar, y cada
    // refresco extiende `exp` un dia mas. Con la cookie a 30 dias, un usuario
    // activo puede arrastrar el rol viejo durante semanas.
    //
    // Invalidar el refresh token corta esa cadena: el JWT que ya tiene sigue
    // siendo valido hasta su `exp` (24 h como mucho) pero no se puede
    // extender, asi que el usuario vuelve a loguearse y entra con el rol
    // nuevo. NO es inmediato, y no hay forma de que lo sea sin leer el rol de
    // la BD en cada request.
    //
    // Se invalida SIEMPRE, suba o baje de rol: una promocion que no aplica
    // hasta mañana es un pedido de soporte igual que una degradacion.
    await invalidateRefreshToken(id)

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: organizationId,
      user_id: userId,
      action: "UPDATE",
      entity: "users",
      entity_id: id,
      changes: {
        field: "rol",
        before: rolAnterior,
        after: rol,
        porcentaje_comision_before: usuario.porcentaje_comision ?? null,
        porcentaje_comision_after: ROLES_CON_COMISION.has(rol)
          ? porcentajeComision
          : (usuario.porcentaje_comision ?? null),
        action_description: `Rol de "${usuario.nombre}" cambiado de ${rolAnterior} a ${rol}`,
      },
    })

    return NextResponse.json({
      success: true,
      rol,
      // Lo consume la pantalla para avisar que la persona tiene que volver a
      // entrar: sin ese aviso el ADMIN cree que ya aplico y abre un ticket.
      sesionCerrada: true,
      message: `${usuario.nombre} ahora es ${rol}. Va a tener que volver a iniciar sesión para que el cambio tenga efecto.`,
    })
  } catch (err) {
    console.error("Error cambiando el rol del usuario:", err)
    return NextResponse.json(
      { error: "Error al cambiar el rol del usuario" },
      { status: 500 }
    )
  }
}
