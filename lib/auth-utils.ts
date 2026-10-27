import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { validateUserTenant } from "@/lib/tenant"
import { supabaseAdmin } from "@/lib/supabase"
import { conSucursalVigente } from "@/lib/sesion-sucursal"
import { clearSessionCookie } from "@/lib/session-cookie"

export async function getAuthSession() {
  const session = await auth()
  if (!session?.user) {
    return { session: null, organizationId: null, userId: null, role: null }
  }
  return {
    session,
    organizationId: session.user.organizationId,
    userId: session.user.id,
    role: session.user.role,
  }
}

// requireAuth() checks the session against the user's row (see conSucursalVigente)
// and, for TECNICO/VENDEDOR, returns it with `user.sucursalId` taken from the DB,
// not from the JWT, which keeps the branch the user had at login for hours after
// an ADMIN moves them. A stale session is a 401 SESSION_STALE that clears the cookie.
export async function requireAuth() {
  const { session, organizationId, userId, role } = await getAuthSession()
  if (!session || !organizationId) {
    return {
      error: NextResponse.json({ error: "No autorizado" }, { status: 401 }),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
    }
  }

  // Validar contexto de tenant si existe (subdominio). The branch lookup is an
  // independent round-trip, so it runs alongside the tenant check instead of
  // after it. A tenant 403 wins and discards whatever the lookup answered.
  const headersList = await headers()
  const tenantSlug = headersList.get("x-tenant-slug")

  const [isValidTenant, vigente] = await Promise.all([
    tenantSlug ? validateUserTenant(organizationId, tenantSlug) : true,
    // Settled, never rejects: a tenant 403 or a throw while this is in flight
    // must not leave an unhandled rejection behind.
    conSucursalVigente(session).then(
      (sesionVigente) => ({ sesionVigente, fallo: false as const }),
      (err: unknown) => ({ sesionVigente: null, fallo: true as const, err })
    ),
  ])

  if (!isValidTenant) {
    return {
      error: NextResponse.json(
        { error: "No tienes acceso a esta organización" },
        { status: 403 }
      ),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
    }
  }

  // Fail-closed on a failed lookup: no 200 on a guessed branch (rationale in
  // conSucursalVigente).
  if (vigente.fallo) {
    console.error("[auth] Could not re-read the user's row:", vigente.err)
    return {
      error: NextResponse.json(
        { error: "No pudimos verificar tu sesión. Intentá de nuevo." },
        { status: 500 }
      ),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
    }
  }
  // The JWT no longer describes the user (row gone or deleted, role or
  // organization changed in the DB, ADMIN included): 401 SESSION_STALE and clear
  // the session cookie in the same response. Without that the browser keeps the
  // stale token and every request repeats this 401; with it the next navigation
  // carries no token and the middleware sends the user to /login. The error is a
  // NextResponse, so the cookie rides on it and nothing else has to change.
  const sesionVigente = vigente.sesionVigente
  if (!sesionVigente) {
    return {
      error: clearSessionCookie(
        NextResponse.json(
          { error: "Tu sesión cambió. Volvé a iniciar sesión.", code: "SESSION_STALE" },
          { status: 401 }
        )
      ),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
    }
  }

  return { error: null, session: sesionVigente, organizationId, userId, role }
}

/**
 * For server pages/layouts that call `auth()` themselves and need the user's
 * branch: same fresh value requireAuth() gives the API. Reading
 * `session.user.sucursalId` from a raw `auth()` returns the stale JWT value
 * (the session-sucursal-sweep test enforces this).
 *
 * Returns null without a session or when the JWT no longer matches the user's
 * row (gone, deleted, role or organization changed); THROWS when
 * the lookup fails, so the page errors instead of rendering on a guessed branch.
 */
export async function sesionConSucursalVigente() {
  const session = await auth()
  if (!session?.user) return null
  return conSucursalVigente(session)
}

export async function requireAdmin() {
  const result = await requireAuth()
  if (result.error) return result

  if (result.role !== "ADMIN") {
    return {
      error: NextResponse.json({ error: "Acceso denegado" }, { status: 403 }),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
    }
  }
  return result
}

// ADMIN OR el propio técnico accediendo a sus datos
export async function requireAdminOrSelf(targetUserId: string) {
  const result = await requireAuth()
  if (result.error) return result

  if (result.role !== "ADMIN" && result.userId !== targetUserId) {
    return {
      error: NextResponse.json({ error: "Acceso denegado" }, { status: 403 }),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
    }
  }
  return result
}

// VENDEDOR puede: crear clientes, crear órdenes, ver inventario
// No puede: modificar inventario, acceder a configuración, gestionar usuarios
export async function requireAdminOrVendedor() {
  const result = await requireAuth()
  if (result.error) return result

  if (result.role !== "ADMIN" && result.role !== "VENDEDOR") {
    return {
      error: NextResponse.json({ error: "Acceso denegado" }, { status: 403 }),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
    }
  }
  return result
}

// Regla pura de acceso a administración de inventario (incluye costos de
// compra: precioCompra/precio_compra). ADMIN siempre; VENDEDOR solo si la
// org habilitó el permiso (opt-in, default apagado); TECNICO y cualquier
// otro rol, nunca.
export function hasInventarioAccess(
  role: string | null,
  vendedoresHabilitados: boolean
): boolean {
  if (role === "ADMIN") return true
  if (role === "VENDEDOR") return vendedoresHabilitados
  return false
}

// Regla pura de acceso al POS y a las ventas de mostrador. ADMIN y VENDEDOR
// siempre: vender ES su rol. TECNICO solo si la org habilitó el permiso
// (opt-in, default apagado); cualquier otro rol, nunca.
//
// El flag NO cambia el rol del técnico: sigue siendo TECNICO, así que sigue
// apareciendo en la lista de asignables a órdenes y conserva "Mi desempeño" y
// sus comisiones de reparación. Es exactamente el motivo por el que esto es un
// permiso y no un cambio de rol a VENDEDOR, que sería un canje y no una suma.
export function hasPosAccess(
  role: string | null,
  tecnicosHabilitados: boolean
): boolean {
  if (role === "ADMIN") return true
  if (role === "VENDEDOR") return true
  if (role === "TECNICO") return tecnicosHabilitados
  return false
}

// Regla pura de acceso a la operativa de caja: abrir el turno, cerrarlo con
// arqueo y cargar movimientos manuales. ADMIN siempre. VENDEDOR solo si la org
// habilitó el permiso (opt-in, default apagado), mismo patrón que
// `vendedores_administran_inventario` y `tecnicos_operan_pos`.
//
// El TECNICO queda afuera incluso con el flag prendido: este permiso habilita
// al VENDEDOR y a nadie más. `tecnicos_operan_pos` lo deja vender, que no es lo
// mismo que arquear la caja del local.
//
// NO cubre el histórico financiero —export CSV e historial de cierres siguen
// siendo del ADMIN—: el vendedor opera SU turno, el dueño audita todos.
export function hasCajaAccess(
  role: string | null,
  vendedoresHabilitados: boolean
): boolean {
  if (role === "ADMIN") return true
  if (role === "VENDEDOR") return vendedoresHabilitados
  return false
}

// Alcance de lectura de ventas: ¿el actor ve solo las suyas, o las de toda la
// sucursal? Solo el ADMIN ve las del resto.
//
// Existe como regla con nombre porque las rutas preguntaban `role ===
// "VENDEDOR"`, que era un sinónimo correcto de "no es admin" mientras el POS
// tenía exactamente dos roles. Con el técnico habilitado adentro dejó de
// serlo: el técnico caía en el `else` y veía las ventas de TODA la sucursal.
// Preguntar por lo que la regla es —no ser ADMIN— la deja bien ante el
// próximo rol también.
export function soloVeSusVentas(role: string | null): boolean {
  return role !== "ADMIN"
}

// Resuelve el flag `tecnicos_operan_pos` de la org. Solo hace falta cuando el
// actor es TECNICO (ver hasPosAccess); llamarlo para ADMIN o VENDEDOR es un
// round-trip al pedo, porque ninguno de los dos depende del flag.
//
// Fail-closed: si la columna todavía no existe o la lectura falla, devuelve
// false y el TECNICO queda afuera — idéntico al comportamiento histórico. En
// este proyecto las migraciones se aplican A MANO y después del merge, así que
// siempre hay una ventana en la que el deploy va adelante de su migración;
// durante esa ventana el permiso simplemente todavía no está.
export async function resolveTecnicosOperanPos(organizationId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("organizations")
      .select("tecnicos_operan_pos")
      .eq("id", organizationId)
      .single()
    return data?.tecnicos_operan_pos === true
  } catch {
    return false
  }
}

// Guard de los endpoints del POS y de ventas de mostrador. Mismo contrato que
// requireAdminOrVendedor() para swap 1:1, más `tecnicosOperanPos` para los
// handlers que necesitan saber si el permiso está prendido (p. ej. quién es
// acreditable como operador de la venta).
export async function requirePosAccess() {
  const result = await requireAuth()
  if (result.error) return { ...result, tecnicosOperanPos: false }

  const tecnicosOperanPos = result.role === "TECNICO"
    ? await resolveTecnicosOperanPos(result.organizationId!)
    : false

  if (!hasPosAccess(result.role, tecnicosOperanPos)) {
    return {
      error: NextResponse.json({ error: "Acceso denegado" }, { status: 403 }),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
      tecnicosOperanPos: false,
    }
  }
  return { ...result, tecnicosOperanPos }
}

// Regla pura de acceso al cobro de una cotización: convertir una cotización
// ACEPTADA en venta. ADMIN siempre. TECNICO solo si la org habilitó el permiso
// (opt-in, default apagado), mismo patrón que `tecnicos_operan_pos`.
//
// El VENDEDOR queda afuera, como estaba: este permiso habilita al TECNICO y a
// nadie más. Abrirle la puerta al vendedor de paso sería un cambio de conducta
// que nadie pidió, y no es lo que dice el nombre del flag.
//
// Ojo con lo que esta regla NO decide: CUÁLES cotizaciones. El técnico
// habilitado cierra las que él creó y ninguna más, y ese alcance lo pone el
// handler con `created_by`, igual que ya lo hacen aprobar, enviar y duplicar.
// Meterlo acá sería mentir sobre lo que la función mira: recibe un rol y un
// flag, no una cotización.
export function hasCotizacionCobroAccess(
  role: string | null,
  tecnicosHabilitados: boolean
): boolean {
  if (role === "ADMIN") return true
  if (role === "TECNICO") return tecnicosHabilitados
  return false
}

// Resuelve el flag `tecnicos_cobran_cotizaciones` de la org. Solo hace falta
// cuando el actor es TECNICO (ver hasCotizacionCobroAccess); llamarlo para
// ADMIN es un round-trip al pedo, porque no depende del flag.
//
// Fail-closed: si la columna todavía no existe o la lectura falla, devuelve
// false y el TECNICO queda afuera — idéntico al comportamiento histórico. En
// este proyecto las migraciones se aplican A MANO y después del merge, así que
// siempre hay una ventana en la que el deploy va adelante de su migración;
// durante esa ventana el permiso simplemente todavía no está.
export async function resolveTecnicosCobranCotizaciones(organizationId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("organizations")
      .select("tecnicos_cobran_cotizaciones")
      .eq("id", organizationId)
      .single()
    return data?.tecnicos_cobran_cotizaciones === true
  } catch {
    return false
  }
}

// Guard del cobro de cotizaciones. Mismo contrato que requireAdmin() para swap
// 1:1, más `tecnicosCobranCotizaciones` para que el handler sepa si entró por
// el permiso y tenga que acotar por `created_by`.
//
// Eliminar, revisar y convertir a orden de servicio NO pasan por acá: siguen en
// requireAdmin()/`role !== "ADMIN"`. Este permiso es el cobro y nada más.
export async function requireCotizacionCobroAccess() {
  const result = await requireAuth()
  if (result.error) return { ...result, tecnicosCobranCotizaciones: false }

  const tecnicosCobranCotizaciones = result.role === "TECNICO"
    ? await resolveTecnicosCobranCotizaciones(result.organizationId!)
    : false

  if (!hasCotizacionCobroAccess(result.role, tecnicosCobranCotizaciones)) {
    return {
      error: NextResponse.json(
        { error: "Solo administradores pueden convertir cotizaciones a venta" },
        { status: 403 }
      ),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
      tecnicosCobranCotizaciones: false,
    }
  }
  return { ...result, tecnicosCobranCotizaciones }
}

// Resolves the `tecnicos_toman_ordenes` flag of the org (migration 374). Only
// needed when the actor is a TECNICO; calling it for other roles is a wasted
// round-trip because none of them depends on the flag.
//
// Fail-closed, like resolveTecnicosOperanPos: if the column does not exist yet
// or the read fails it returns false and the TECNICO sees and does exactly what
// he did before. Migrations here are applied BY HAND after the merge, so there
// is always a window where the deploy is ahead of its column.
export async function resolveTecnicosTomanOrdenes(organizationId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("organizations")
      .select("tecnicos_toman_ordenes")
      .eq("id", organizationId)
      .single()
    return data?.tecnicos_toman_ordenes === true
  } catch {
    return false
  }
}

// Regla pura de acceso a los reportes de INGRESOS del taller. ADMIN siempre.
// VENDEDOR salvo que la organización lo haya apagado.
//
// Ojo con la forma, que es la inversa de hasInventarioAccess / hasPosAccess /
// hasCajaAccess: aquéllas preguntan "¿la org habilitó esto?" sobre algo que
// nadie tenía. Ésta pregunta "¿la org NO lo deshabilitó?" sobre algo que todos
// tienen. Por eso el parámetro se llama `habilitado` y llega en true por
// default, y por eso la columna de la 326 es DEFAULT true.
//
// El TECNICO queda afuera igual: el middleware no lo deja entrar a /reportes,
// así que acá no hay nada que decidir para él.
export function hasIngresosAccess(
  role: string | null,
  vendedoresHabilitados: boolean
): boolean {
  if (role === "ADMIN") return true
  if (role === "VENDEDOR") return vendedoresHabilitados
  return false
}

// Resuelve el flag `vendedores_ven_ingresos` de la org. Solo hace falta cuando
// el actor es VENDEDOR (ver hasIngresosAccess).
//
// FAIL-OPEN, y es deliberado: devuelve true cuando no se pudo determinar. Es
// lo contrario de resolveTecnicosOperanPos y compañía, que son fail-closed, y
// la diferencia no es un descuido.
//
// Aquéllas resuelven un permiso que nadie tenía: ante la duda, negarlo deja
// las cosas como estaban. Ésta resuelve uno que TODOS tienen: ante la duda,
// negarlo le SACA los reportes a todos los vendedores de todas las
// organizaciones —incluidas las 222 que nunca pidieron nada— por una columna
// sin migrar o una lectura que falló. Eso es la denegación fabricada que este
// proyecto ya corrigió en /api/org/features y en el gate del POS.
//
// Lo que se paga a cambio: si la migración YA corrió, el taller apagó el flag
// y justo falla la lectura, ese vendedor ve los ingresos esa vez. Es una
// preferencia de confidencialidad que se degrada de forma visible, no un
// límite de seguridad: los COSTOS siguen cerrados aparte por canViewCost, y
// eso no depende de este flag ni de esta lectura.
export async function resolveVendedoresVenIngresos(organizationId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from("organizations")
      .select("vendedores_ven_ingresos")
      .eq("id", organizationId)
      .single()
    if (error || !data) return true
    // Solo un false EXPLÍCITO cierra. Un null —columna recién agregada, fila
    // vieja— es "no lo apagó nadie".
    return data.vendedores_ven_ingresos !== false
  } catch {
    return true
  }
}

// Guard de los reportes de ingresos. Mismo contrato que
// requireAdminOrVendedor() para swap 1:1, que es como entra en las 5 rutas.
export async function requireIngresosAccess() {
  const result = await requireAuth()
  if (result.error) return { ...result, vendedoresVenIngresos: true }

  const vendedoresVenIngresos = result.role === "VENDEDOR"
    ? await resolveVendedoresVenIngresos(result.organizationId!)
    : true

  if (!hasIngresosAccess(result.role, vendedoresVenIngresos)) {
    return {
      error: NextResponse.json({ error: "Acceso denegado" }, { status: 403 }),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
      vendedoresVenIngresos: false,
    }
  }
  return { ...result, vendedoresVenIngresos }
}

// Resuelve el flag `vendedores_manejan_caja` de la org. Solo hace falta cuando
// el actor es VENDEDOR (ver hasCajaAccess); llamarlo para ADMIN es un
// round-trip al pedo, porque no depende del flag.
//
// Fail-closed: si la columna todavía no existe o la lectura falla, devuelve
// false y el VENDEDOR queda afuera — idéntico al comportamiento histórico. En
// este proyecto las migraciones se aplican A MANO y después del merge, así que
// siempre hay una ventana en la que el deploy va adelante de su migración;
// durante esa ventana el permiso simplemente todavía no está.
export async function resolveVendedoresManejanCaja(organizationId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("organizations")
      .select("vendedores_manejan_caja")
      .eq("id", organizationId)
      .single()
    return data?.vendedores_manejan_caja === true
  } catch {
    return false
  }
}

// Guard de la operativa de caja: apertura, cierre con arqueo y movimientos
// manuales. Mismo contrato que requireAdmin() para swap 1:1, más
// `vendedoresManejanCaja` para los handlers que necesiten saber si el permiso
// está prendido.
//
// El export CSV y el historial de cierres NO pasan por acá: siguen en
// requireAdmin(). El vendedor opera su turno; el histórico financiero de la
// organización es del dueño.
export async function requireCajaAccess() {
  const result = await requireAuth()
  if (result.error) return { ...result, vendedoresManejanCaja: false }

  const vendedoresManejanCaja = result.role === "VENDEDOR"
    ? await resolveVendedoresManejanCaja(result.organizationId!)
    : false

  if (!hasCajaAccess(result.role, vendedoresManejanCaja)) {
    return {
      error: NextResponse.json({ error: "Acceso denegado" }, { status: 403 }),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
      vendedoresManejanCaja: false,
    }
  }
  return { ...result, vendedoresManejanCaja }
}

// Resuelve el flag `vendedores_administran_inventario` de la org. Solo hace
// falta cuando el actor es VENDEDOR (ver hasInventarioAccess); llamarlo para
// otros roles es un round-trip innecesario. Fail-closed: si la columna no
// existe o la lectura falla, devuelve false (VENDEDOR queda denegado,
// idéntico al comportamiento histórico).
export async function resolveVendedoresHabilitados(organizationId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("organizations")
      .select("vendedores_administran_inventario")
      .eq("id", organizationId)
      .single()
    return data?.vendedores_administran_inventario === true
  } catch {
    return false
  }
}

// Resolutor perezoso y memoizado de hasInventarioAccess, para rutas calientes.
//
// resolveVendedoresHabilitados es un SELECT sin cache. Resolverlo arriba de
// todo hace pagar ese round-trip incluso cuando la respuesta no lleva ningún
// costo (query vacía, cero resultados, early return). /api/inventario/search
// corre por cada tecla del buscador del POS, así que era un round-trip por
// tecla y por sesión de VENDEDOR.
//
// Se llama recién donde el costo se escribiría en la respuesta. La promesa
// queda memoizada: un request que sí necesita el permiso paga exactamente uno.
// El gate no se debilita — la misma regla, resuelta más tarde.
export function lazyInventarioAccess(
  role: string | null,
  organizationId: string
): () => Promise<boolean> {
  let pending: Promise<boolean> | null = null
  return () => {
    if (!pending) {
      pending = role === "VENDEDOR"
        ? resolveVendedoresHabilitados(organizationId).then((habilitados) =>
            hasInventarioAccess(role, habilitados)
          )
        : Promise.resolve(hasInventarioAccess(role, false))
    }
    return pending
  }
}

// Guard de endpoints de inventario. Mismo contrato que requireAdmin() para
// swap 1:1. Fail-closed: si la columna no existe o la lectura falla,
// el VENDEDOR queda denegado (idéntico al comportamiento histórico).
export async function requireInventarioAccess() {
  const result = await requireAuth()
  if (result.error) return result

  if (result.role === "ADMIN") return result

  const vendedoresHabilitados = result.role === "VENDEDOR"
    ? await resolveVendedoresHabilitados(result.organizationId!)
    : false

  if (!hasInventarioAccess(result.role, vendedoresHabilitados)) {
    return {
      error: NextResponse.json({ error: "Acceso denegado" }, { status: 403 }),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
    }
  }
  return result
}

// Mismo permiso que requireInventarioAccess, para handlers que YA resolvieron
// la sesión y solo lo necesitan para PARTE de su trabajo. Devuelve la respuesta
// 403 a retornar, o null si el actor pasa.
//
// Existe por /api/import: un solo handler atiende CLIENTES e INVENTARIO
// (`entityType`), y solo la segunda es una escritura de inventario. Ahí el
// guard no puede ir arriba de todo —denegaría la importación de clientes, que
// es otro permiso— y tampoco puede resolverse llamando de nuevo a
// requireInventarioAccess, que volvería a pedir la sesión entera.
//
// Fail-closed igual que el guard: si el flag no se puede leer, el VENDEDOR
// queda denegado (ver resolveVendedoresHabilitados).
export async function denyIfNoInventarioAccess(
  role: string | null,
  organizationId: string
): Promise<NextResponse | null> {
  // El ADMIN no necesita el round-trip: hasInventarioAccess ya lo aprueba.
  const vendedoresHabilitados = role === "VENDEDOR"
    ? await resolveVendedoresHabilitados(organizationId)
    : false

  if (hasInventarioAccess(role, vendedoresHabilitados)) return null
  return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
}

// Regla pura de acceso a costo/margen de cotizaciones (costoUnitario,
// "Ganancia bruta"). ADMIN unicamente, de forma uniforme — VENDEDOR queda
// afuera aunque tenga acceso a inventario, porque hoy no tiene navegación a
// cotizaciones; TECNICO nunca. Distinta de hasInventarioAccess a propósito:
// costo de cotización y costo de inventario son permisos independientes.
export function canViewCotizacionCosts(role: string | null): boolean {
  return role === "ADMIN"
}

// Verifica si el usuario puede crear órdenes y clientes (ADMIN, VENDEDOR)
export function canCreateOrders(role: string | null): boolean {
  return role === "ADMIN" || role === "VENDEDOR"
}

// Verifica si el usuario actual puede importar datos
export async function canImportData(): Promise<boolean> {
  const { session } = await getAuthSession()
  return !!session?.user?.email
}

// Verifica si el usuario actual puede editar configuración (ADMIN)
export async function canEditConfiguration(): Promise<boolean> {
  const { session, role } = await getAuthSession()
  return !!session?.user?.email && role === "ADMIN"
}
