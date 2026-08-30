import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { validateUserTenant } from "@/lib/tenant"
import { supabaseAdmin } from "@/lib/supabase"

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

  // Validar contexto de tenant si existe (subdominio)
  const headersList = await headers()
  const tenantSlug = headersList.get("x-tenant-slug")

  if (tenantSlug) {
    const isValidTenant = await validateUserTenant(organizationId, tenantSlug)
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
  }

  return { error: null, session, organizationId, userId, role }
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
