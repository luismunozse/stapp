import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"

export const SUCURSAL_COOKIE = "stapp-sucursal-activa"
const TODAS = "todas"

/**
 * Sentinel UUID used when a non-admin user has no assigned branch.
 * Applying .eq("sucursal_id", SUCURSAL_NINGUNA) matches zero real rows,
 * so the query returns empty rather than leaking all branches (fail-closed).
 */
export const SUCURSAL_NINGUNA = "00000000-0000-0000-0000-000000000000"

export interface ResultadoLectura {
  sucursalId: string | null // null => sin filtro de sucursal (ver todas)
  verTodas: boolean
}

interface InputResolucion {
  role: string | null
  userSucursalId: string | null
  cookieSucursalId: string | null
}

/** Resuelve el filtro de sucursal para LECTURAS. */
export function resolveSucursalLectura(input: InputResolucion): ResultadoLectura {
  const esAdmin = input.role === "ADMIN"

  if (!esAdmin) {
    // TECNICO/VENDEDOR must always be branch-scoped. If their sucursal_id is null
    // (invalid state, e.g. role changed from ADMIN without assigning a branch),
    // return the sentinel so the .eq filter matches zero rows instead of leaking
    // all branches (fail-closed rather than fail-open).
    return { sucursalId: input.userSucursalId ?? SUCURSAL_NINGUNA, verTodas: false }
  }

  // ADMIN: cookie manda. Sin cookie o 'todas' => ver todas.
  if (!input.cookieSucursalId || input.cookieSucursalId === TODAS) {
    return { sucursalId: null, verTodas: true }
  }
  return { sucursalId: input.cookieSucursalId, verTodas: false }
}

/**
 * The part of the write resolution that does NOT depend on the org's principal
 * sucursal: a branch-scoped user's own branch, or the branch an ADMIN has
 * explicitly selected. Returns null only when the principal fallback is the
 * answer, so callers can keep resolving even if that org-level lookup fails.
 */
export function resolveSucursalPropia(input: InputResolucion): string | null {
  const esAdmin = input.role === "ADMIN"

  if (!esAdmin) {
    return input.userSucursalId
  }
  if (!input.cookieSucursalId || input.cookieSucursalId === TODAS) {
    return null
  }
  return input.cookieSucursalId
}

/** Resuelve la sucursal CONCRETA para ESCRITURAS (siempre devuelve un id). */
export function resolveSucursalEscritura(
  input: InputResolucion & { principalId: string }
): string {
  return resolveSucursalPropia(input) ?? input.principalId
}

/** Lee el id de la sucursal principal (Casa Central) de una org. */
export async function getPrincipalId(organizationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("sucursales")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("principal", true)
    .is("deleted_at", null)
    .single()
  return data?.id ?? null
}

/** Valida que una sucursal pertenezca a la org y esté activa. Previene cross-org. */
export async function assertSucursalEnOrg(
  sucursalId: string,
  organizationId: string
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("sucursales")
    .select("id")
    .eq("id", sucursalId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .single()
  return !!data
}

/** Lee la cookie de sucursal activa (server-side). */
export async function getCookieSucursalId(): Promise<string | null> {
  const store = await cookies()
  return store.get(SUCURSAL_COOKIE)?.value ?? null
}

/** Resuelve la sucursal concreta para una ESCRITURA en el request actual. */
export async function sucursalParaEscritura(params: {
  role: string | null
  organizationId: string
  userSucursalId: string | null
}): Promise<string | null> {
  const cookieSucursalId = await getCookieSucursalId()
  const principalId = await getPrincipalId(params.organizationId)
  // The principal sucursal is a FALLBACK, not a precondition. Bailing out on a
  // null principalId used to collapse a user whose own sucursal is perfectly
  // configured — and `derivarLecturaVenta` then read that null as "no branch",
  // widening POS reads org-wide. getPrincipalId returns null for a missing
  // principal, for two rows flagged principal (its .single() errors, and the
  // demote in POST /api/sucursales is not atomic with the insert), and for any
  // transient query failure, so it must not be able to unscope anyone.
  return resolveSucursalPropia({
    role: params.role,
    userSucursalId: params.userSucursalId,
    cookieSucursalId,
  }) ?? principalId
}

/** Resuelve el filtro de sucursal para una LECTURA en el request actual. */
export async function sucursalParaLectura(params: {
  role: string | null
  userSucursalId: string | null
}): Promise<ResultadoLectura> {
  const cookieSucursalId = await getCookieSucursalId()
  return resolveSucursalLectura({
    role: params.role,
    userSucursalId: params.userSucursalId,
    cookieSucursalId,
  })
}

/**
 * Returns the principal deposito id for a sucursal, or null if none exists.
 * Used by sales routes to resolve the strict deposit for stock deduction.
 */
export async function getDepositoDeSucursal(
  organizationId: string,
  sucursalId: string
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("depositos")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("sucursal_id", sucursalId)
    .eq("principal", true)
    .is("deleted_at", null)
    .maybeSingle()
  return data?.id ?? null
}

export interface DestinoVenta {
  /** Concrete sucursal a POS sale will be attributed to, null if the org has no principal sucursal. */
  sucursalId: string | null
  /** Concrete deposito a POS sale will draw stock from, null if the sucursal has no principal deposito (drain-mode fallback). */
  depositoId: string | null
  /**
   * True when a non-ADMIN caller has no assigned sucursal, i.e. `sucursalId`
   * above is only the write path's principal fallback and does NOT reflect a
   * branch this user belongs to. Reads must go fail-closed in that state
   * (see `derivarLecturaVenta`); writes keep the fallback.
   */
  unassignedSucursal: boolean
  /**
   * True when the caller's role is pinned to a single branch (VENDEDOR/TECNICO)
   * rather than being org-wide (ADMIN). Decides whether widening a read past
   * that branch is ever legitimate — see `derivarLecturaVenta`.
   */
  branchScoped: boolean
}

/**
 * Resolves the concrete sucursal + deposito a POS sale will draw stock from
 * for the current request — the exact same resolution as the ventas write
 * path (`sucursalParaEscritura` + `getDepositoDeSucursal`). Exposed as a
 * single helper so the ventas write route and the POS read endpoints
 * (search/barcode/check-stock, via their opt-in `scope=venta` query param)
 * do not drift apart on which sucursal/deposito a sale actually uses.
 *
 * The guarantee reaches exactly as far as `scope=venta` does — today, POS. The
 * other sale surfaces (venta-form, venta-edit-form, cotizaciones item-row) POST
 * to /api/ventas but still read stock unscoped, so the original read/write
 * drift is unchanged there.
 *
 * ADMIN vs non-ADMIN asymmetry, deliberate: for an ADMIN the "no sucursal
 * selected" state means "all branches", so falling back to the principal
 * sucursal is the correct sale target. For a TECNICO/VENDEDOR a null
 * `sucursal_id` is an invalid state, not a wider scope — the write path still
 * falls back to the principal sucursal (unchanged, pre-existing behavior),
 * but reads must stay fail-closed exactly like `resolveSucursalLectura`'s
 * SUCURSAL_NINGUNA sentinel, so `unassignedSucursal` flags it for callers.
 */
export async function resolverDestinoVenta(params: {
  role: string | null
  organizationId: string
  userSucursalId: string | null
}): Promise<DestinoVenta> {
  const branchScoped = params.role !== "ADMIN"
  const unassignedSucursal = branchScoped && !params.userSucursalId
  const sucursalId = await sucursalParaEscritura(params)
  if (!sucursalId) {
    return { sucursalId: null, depositoId: null, unassignedSucursal, branchScoped }
  }

  const depositoId = await getDepositoDeSucursal(params.organizationId, sucursalId)
  if (!depositoId) {
    console.warn(
      `[ventas] Sucursal ${sucursalId} has no principal deposito — falling back to drain mode`
    )
  }

  return { sucursalId, depositoId, unassignedSucursal, branchScoped }
}

export interface LecturaVenta {
  /** Sucursal the read is scoped to; SUCURSAL_NINGUNA when fail-closed. */
  sucursalId: string | null
  /** Concrete deposito to read stock from, null when reading the aggregate or fail-closed. */
  depositoId: string | null
  /** True => read the org-wide aggregate, mirroring the write path's drain mode. */
  verTodas: boolean
  /**
   * Sucursal the POS "selling from" indicator may name, or null when no single
   * sucursal can be honestly asserted (see `derivarLecturaVenta`). Deliberately
   * NOT the same as `sucursalId`: the read scope and what we are willing to
   * claim in the UI diverge in drain mode.
   */
  ventaSucursalId: string | null
}

/**
 * Derives the read scope the POS endpoints must apply for a resolved sale
 * destination. Shared by search/barcode/check-stock so the three cannot drift:
 *
 *  - No assigned sucursal (non-ADMIN): fail-closed — sentinel sucursal, no
 *    deposito and no aggregate, so the caller sees nothing.
 *  - No concrete deposito, ORG-WIDE caller (ADMIN): the write path passes
 *    p_deposito_id = null and drains org-wide, so the read shows the org-wide
 *    aggregate rather than hiding stock a sale could actually decrement.
 *  - No concrete deposito, BRANCH-SCOPED caller (VENDEDOR/TECNICO):
 *    fail-closed. The aggregate counts units physically held by OTHER branches
 *    (and carries precio_compra), so widening here would hand a branch user
 *    another branch's inventory to browse and sell — over a configuration gap
 *    they did not cause and cannot see. Reading nothing is what this state did
 *    before scope=venta existed, and it surfaces as "nothing here, fix the
 *    config" instead of silently selling someone else's stock.
 *  - Otherwise: scope the read to that deposito.
 *
 * On `ventaSucursalId` in drain mode (deliberate asymmetry with `sucursalId`):
 * when the resolved sucursal has no principal deposito, `crear_venta_atomica`
 * calls `descontar_stock_deposito(..., p_deposito_id => null, strict => false)`,
 * which is free to take units from ANY deposito in the org — including another
 * branch's. The sale is still *attributed* to `sucursalId` (so the read stays
 * scoped to it), but the stock origin is genuinely unknown. Naming a single
 * branch in the "Vendiendo desde" indicator would therefore be a lie, so we
 * suppress the indicator instead of wording around it: an absent indicator
 * degrades to the pre-existing UI, while a wrong one actively misinforms the
 * operator about where their inventory went.
 */
export function derivarLecturaVenta(destino: DestinoVenta): LecturaVenta {
  const failClosed: LecturaVenta = {
    sucursalId: SUCURSAL_NINGUNA,
    depositoId: null,
    verTodas: false,
    ventaSucursalId: null,
  }

  if (destino.unassignedSucursal) return failClosed

  // Drain mode widens the read to the whole org. That is only ever acceptable
  // for a role that is legitimately org-wide.
  if (!destino.depositoId && destino.branchScoped) return failClosed

  return {
    sucursalId: destino.sucursalId,
    depositoId: destino.depositoId,
    verTodas: !destino.depositoId,
    ventaSucursalId: destino.depositoId ? destino.sucursalId : null,
  }
}

// ─── POS read-path resolution cache ───
//
// `scope=venta` runs on every debounced keystroke of the POS search box, and
// PosProductSearch is mounted twice (desktop + mobile), so this resolution is
// paid several times per second of typing. What it resolves — which sucursal is
// principal, which deposito is that sucursal's principal, the org's sucursal
// list — only changes when an admin edits branch configuration.
//
// READS ONLY. `resolverDestinoVenta` stays uncached so the ventas write path
// never attributes a sale from a possibly-stale entry. The worst case here is
// that POS reads keep the previous scope for up to one TTL after a
// configuration change — the same short-TTL tradeoff lib/tenant-status-edge.ts
// already makes, and self-healing without a deploy.

const CACHE_VENTA_TTL_MS = 30_000
/** Above this many live entries, expired ones are swept before inserting. */
const CACHE_VENTA_MAX_ENTRIES = 500

interface EntradaCacheVenta<T> {
  data: T
  expiresAt: number
}

const cacheDestinoVenta = new Map<string, EntradaCacheVenta<DestinoVenta>>()
const cacheIndicadorVenta = new Map<string, EntradaCacheVenta<IndicadorVenta>>()

async function memoConTtl<T>(
  store: Map<string, EntradaCacheVenta<T>>,
  key: string,
  resolver: () => Promise<T>,
  /** Optional gate: a result it rejects is returned but never stored. */
  cacheable?: (data: T) => boolean
): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && hit.expiresAt > now) return hit.data

  const data = await resolver()
  if (cacheable && !cacheable(data)) return data
  if (store.size >= CACHE_VENTA_MAX_ENTRIES) {
    for (const [k, entry] of store) {
      if (entry.expiresAt <= now) store.delete(k)
    }
  }
  store.set(key, { data, expiresAt: now + CACHE_VENTA_TTL_MS })
  return data
}

/**
 * Clears the POS read-path cache. Exported for tests, and safe to call after a
 * sucursal/deposito configuration change to drop the TTL window entirely.
 */
export function resetCacheResolucionVenta(): void {
  cacheDestinoVenta.clear()
  cacheIndicadorVenta.clear()
}

/**
 * Cached `resolverDestinoVenta` for the POS READ endpoints
 * (search/barcode/check-stock under `scope=venta`).
 *
 * The caller passes `cookieSucursalId` explicitly — it is already in scope in
 * every route — because it is part of the cache identity: two admins of the
 * same org with different branches selected must never share an entry, and
 * neither must two orgs or two roles. Everything that can change the answer is
 * in the key.
 */
export async function resolverDestinoVentaCacheado(params: {
  role: string | null
  organizationId: string
  userSucursalId: string | null
  cookieSucursalId: string | null
}): Promise<DestinoVenta> {
  const key = JSON.stringify([
    params.organizationId,
    params.role,
    params.userSucursalId,
    params.cookieSucursalId,
  ])
  return memoConTtl(
    cacheDestinoVenta,
    key,
    () =>
      resolverDestinoVenta({
        role: params.role,
        organizationId: params.organizationId,
        userSucursalId: params.userSucursalId,
      }),
    // A destination with no sucursal means the resolution did not land — which
    // for an org-wide caller reads as the org aggregate. That can come from a
    // transient failure, so it is served but never pinned for a whole TTL: the
    // next request retries instead of inheriting the failure.
    (destino) => destino.sucursalId !== null
  )
}

/** Cached `resolverIndicadorVenta` — see `resolverDestinoVentaCacheado`. */
export async function resolverIndicadorVentaCacheado(params: {
  role: string | null
  organizationId: string
  cookieSucursalId: string | null
  ventaSucursalId: string | null
}): Promise<string | null> {
  // The gate below the query is pure, so short-circuit before touching the
  // cache: hidden-indicator callers then cost neither a query nor an entry.
  if (!params.ventaSucursalId || params.role !== "ADMIN") return null

  const key = JSON.stringify([
    params.organizationId,
    params.role,
    params.cookieSucursalId,
    params.ventaSucursalId,
  ])
  const indicador = await memoConTtl(
    cacheIndicadorVenta,
    key,
    () => resolverIndicadorVentaInterno(params),
    // A failed sucursal list reads as "hide the indicator", which is
    // indistinguishable from the legitimate hidden cases by the name alone.
    // Pinning it would be worse here than for the destination: the client reads
    // the header once, on mount, so a single blip would hide the indicator for
    // the whole POS session rather than for one TTL.
    (resultado) => resultado.resuelto
  )
  return indicador.nombre
}

interface IndicadorVenta {
  /** Label for the indicator, or null when it must stay hidden. */
  nombre: string | null
  /**
   * False when the sucursal list query failed, i.e. `nombre` is null because we
   * could not look it up — not because the indicator should be hidden.
   */
  resuelto: boolean
}

/**
 * Resolves the label for the POS "Vendiendo desde" indicator, or null when the
 * indicator must not be shown at all.
 *
 * This gate lives on the server on purpose. The sucursal cookie is httpOnly, so
 * the browser can only guess at the selector state from the `sucursal-activa-ui`
 * localStorage mirror — and that mirror is written exclusively by
 * `SucursalSwitcher.seleccionar()`. It is therefore absent both for an ADMIN who
 * has simply never used the switcher AND for every single-sucursal org, where
 * the switcher renders null and can never write it. No client-side default can
 * separate those two cases: read a missing mirror as "todas" and single-branch
 * orgs get a permanent, useless "Vendiendo desde: Casa Central"; read it as "not
 * todas" and the indicator never appears for the fresh admin sessions it exists
 * to serve. The server has the real cookie and the sucursal count, so it decides.
 *
 * Returns null (indicator hidden) when:
 *  - there is no sucursal to name — drain mode or fail-closed reads, see
 *    `derivarLecturaVenta`;
 *  - the caller is not an ADMIN — other roles are pinned to one branch and
 *    never see a cross-branch view to disambiguate;
 *  - a concrete sucursal is selected — the switcher already names it;
 *  - the org has a single sucursal — nothing to disambiguate, and this is the
 *    case the switcher itself opts out of.
 *
 * Costs at most one query, and only on the request that opts in (`ventaInfo`).
 */
export async function resolverIndicadorVenta(params: {
  role: string | null
  organizationId: string
  cookieSucursalId: string | null
  ventaSucursalId: string | null
}): Promise<string | null> {
  return (await resolverIndicadorVentaInterno(params)).nombre
}

/**
 * `resolverIndicadorVenta` plus the one bit the caching layer needs and the
 * label alone cannot carry: whether null means "hide it" or "the lookup failed".
 */
async function resolverIndicadorVentaInterno(params: {
  role: string | null
  organizationId: string
  cookieSucursalId: string | null
  ventaSucursalId: string | null
}): Promise<IndicadorVenta> {
  const oculto: IndicadorVenta = { nombre: null, resuelto: true }

  if (!params.ventaSucursalId) return oculto
  if (params.role !== "ADMIN") return oculto
  if (params.cookieSucursalId && params.cookieSucursalId !== TODAS) return oculto

  const { data, error } = await supabaseAdmin
    .from("sucursales")
    .select("id, nombre")
    .eq("organization_id", params.organizationId)
    .is("deleted_at", null)

  // A successful read of an org with no sucursales returns [], never null — so
  // either branch here is a real failure, and must not be pinned as "hidden".
  if (error || !data) {
    console.warn(
      `[ventas] Could not load sucursales for org ${params.organizationId} — hiding the selling-from indicator:`,
      error?.message ?? "no data returned"
    )
    return { nombre: null, resuelto: false }
  }

  const sucursales = data as Array<{ id: string; nombre: string }>
  if (sucursales.length <= 1) return oculto

  return {
    nombre: sucursales.find((s) => s.id === params.ventaSucursalId)?.nombre ?? null,
    resuelto: true,
  }
}

/**
 * Reads the display name of a sucursal. Used to name the sucursal in
 * stock-insufficient error messages, without duplicating the
 * sucursal/deposito resolution logic itself.
 */
export async function getNombreSucursal(
  organizationId: string,
  sucursalId: string
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("sucursales")
    .select("nombre")
    .eq("id", sucursalId)
    .eq("organization_id", organizationId)
    .single()
  return data?.nombre ?? null
}
