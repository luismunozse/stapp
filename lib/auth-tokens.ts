import { createHash, randomBytes } from "crypto"
import { supabaseAdmin } from "@/lib/supabase"
import { isUserDeleted, isLoginBlocked } from "@/lib/account-deletion/state"

/**
 * Refresh tokens y revalidación periódica del JWT de sesión.
 *
 * Cada sesión (login o restauración de la PWA) tiene su propia fila en
 * `refresh_tokens`, con el SHA-256 del token. El token en claro existe solo en
 * el JWT cifrado de la cookie y en el almacenamiento local de la PWA.
 *
 * Transición: los tokens emitidos antes de esta tabla siguen en claro en
 * `users.refresh_token` hasta que venzan (30 días como máximo). Se aceptan
 * mientras tanto y se borran al rotarlos o al cerrar esa sesión.
 *
 * Vive fuera de lib/auth.ts para poder testearse: ese módulo arrastra next-auth,
 * que no carga en vitest.
 */

const SEVEN_DAYS = 7 * 24 * 60 * 60
const THIRTY_DAYS = 30 * 24 * 60 * 60

/** Largo de un refresh token en claro: 64 bytes en hex. */
const LARGO_TOKEN = 128

/**
 * Cada cuánto el JWT vuelve a la base a confirmar que su refresh token sigue
 * vigente y a releer rol y sucursal. Es lo que hace efectivos el logout remoto,
 * la revocación de sesiones y el reseteo de contraseña en las sesiones abiertas.
 */
export const REVALIDAR_CADA_SEG = 60 * 60

export function isSuperadminEmail(email: string): boolean {
  const superadminEmails =
    process.env.SUPERADMIN_EMAILS?.split(",").map((e) => e.trim().toLowerCase()) || []
  return superadminEmails.includes(email.toLowerCase())
}

export function hashRefreshToken(refreshToken: string): string {
  return createHash("sha256").update(refreshToken, "utf8").digest("hex")
}

function esTokenBienFormado(refreshToken: unknown): refreshToken is string {
  return typeof refreshToken === "string" && refreshToken.length === LARGO_TOKEN
}

/** Emite un refresh token para una sesión nueva. No toca las demás sesiones del usuario. */
export async function saveRefreshToken(userId: string, rememberMe: boolean): Promise<string> {
  const refreshToken = randomBytes(64).toString("hex")
  const expiresAt = new Date()
  expiresAt.setSeconds(expiresAt.getSeconds() + (rememberMe ? THIRTY_DAYS : SEVEN_DAYS))

  // Limpieza oportunista de las sesiones vencidas del usuario.
  await supabaseAdmin
    .from("refresh_tokens")
    .delete()
    .eq("user_id", userId)
    .lt("expires_at", new Date().toISOString())

  const { error } = await supabaseAdmin.from("refresh_tokens").insert({
    user_id: userId,
    token_hash: hashRefreshToken(refreshToken),
    expires_at: expiresAt.toISOString(),
  })
  if (error) throw new Error(`No se pudo guardar el refresh token: ${error.message}`)

  return refreshToken
}

const SELECT_USUARIO_REFRESH = `
  id,
  email,
  nombre,
  rol,
  organization_id,
  sucursal_id,
  refresh_token_expires,
  deleted_at,
  organizations (id, activo, deleted_at)
`

type OrigenToken = { tipo: "sesion"; id: string } | { tipo: "legado" }

/**
 * Devuelve el usuario dueño del refresh token si el token sigue vigente y el
 * usuario puede iniciar sesión, o null. Incluye `refreshTokenExpira` (ISO) y
 * `refreshTokenOrigen`, que usa la rotación.
 */
export async function validateRefreshToken(refreshToken: string) {
  if (!esTokenBienFormado(refreshToken)) return null

  let origen: OrigenToken
  let expira: string
  let userId: string

  const { data: sesion } = await supabaseAdmin
    .from("refresh_tokens")
    .select("id, user_id, expires_at")
    .eq("token_hash", hashRefreshToken(refreshToken))
    .maybeSingle()

  if (sesion) {
    if (new Date(sesion.expires_at) < new Date()) {
      await supabaseAdmin.from("refresh_tokens").delete().eq("id", sesion.id)
      return null
    }
    origen = { tipo: "sesion", id: sesion.id }
    expira = sesion.expires_at
    userId = sesion.user_id
  } else {
    const { data: legado } = await supabaseAdmin
      .from("users")
      .select("id, refresh_token_expires")
      .eq("refresh_token", refreshToken)
      .maybeSingle()
    if (!legado) return null
    if (!legado.refresh_token_expires || new Date(legado.refresh_token_expires) < new Date()) {
      await supabaseAdmin
        .from("users")
        .update({ refresh_token: null, refresh_token_expires: null })
        .eq("id", legado.id)
      return null
    }
    origen = { tipo: "legado" }
    expira = legado.refresh_token_expires
    userId = legado.id
  }

  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select(SELECT_USUARIO_REFRESH)
    .eq("id", userId)
    .single()

  if (error || !user) return null

  // Usuario dado de baja: no renueva sesión ni entra por el refresh token de la PWA.
  if (isUserDeleted(user)) return null

  // Organización activa (no requerido para superadmin)
  const orgs = user.organizations as unknown
  const org = Array.isArray(orgs) ? orgs[0] : orgs
  if (
    isLoginBlocked(user, org as { activo: boolean; deleted_at?: string | null } | null, {
      isSuper: isSuperadminEmail(user.email),
    })
  ) {
    return null
  }

  return { ...user, refreshTokenExpira: expira, refreshTokenOrigen: origen }
}

/**
 * Revoca UNA sesión: la del refresh token dado (logout de ese dispositivo, o
 * el paso previo a rotarlo).
 */
export async function revocarRefreshToken(refreshToken: string): Promise<void> {
  if (!esTokenBienFormado(refreshToken)) return
  await supabaseAdmin.from("refresh_tokens").delete().eq("token_hash", hashRefreshToken(refreshToken))
  // Token previo a la tabla: solo se borra si coincide, así no corta otra sesión.
  await supabaseAdmin
    .from("users")
    .update({ refresh_token: null, refresh_token_expires: null })
    .eq("refresh_token", refreshToken)
}

/** Revoca TODAS las sesiones del usuario (cambio de rol, reseteo de contraseña, baja). */
export async function invalidateRefreshToken(userId: string): Promise<void> {
  await supabaseAdmin.from("refresh_tokens").delete().eq("user_id", userId)
  await supabaseAdmin
    .from("users")
    .update({ refresh_token: null, refresh_token_expires: null })
    .eq("id", userId)
}

/**
 * Rotación: revoca el token usado y emite uno nuevo para la misma sesión.
 * Se usa al restaurar la sesión de la PWA.
 */
export async function rotarRefreshToken(refreshTokenUsado: string, userId: string): Promise<string> {
  await revocarRefreshToken(refreshTokenUsado)
  return saveRefreshToken(userId, true)
}

type TokenSesion = Record<string, unknown>

/**
 * Revalidación periódica del JWT (la parte "sin login ni update" del callback
 * `jwt`). Usa el claim propio `revalidarEn`: el `exp` del JWT no sirve porque
 * Auth.js lo reescribe a `ahora + maxAge` cada vez que codifica la cookie, así
 * que nunca llegaba al umbral y la sesión no se revalidaba nunca.
 *
 * Los tokens sin `revalidarEn` (emitidos antes de este cambio) se revalidan en
 * el primer request. Los de impersonación no traen refresh token y no pasan
 * por acá: tienen su propio vencimiento (lib/impersonation.ts).
 *
 * No rota el refresh token: la PWA guarda una copia local y no podría
 * enterarse del cambio. Se rota al restaurar la sesión.
 */
export async function revalidarTokenSesion<T extends TokenSesion>(
  token: T,
  ahoraSeg: number = Math.floor(Date.now() / 1000)
): Promise<T> {
  if (token.isImpersonating) return token
  // Ya marcada como vencida: el cliente cierra la sesión, no hace falta volver a la base.
  if (token.error) return token
  if (typeof token.refreshToken !== "string" || !token.refreshToken) return token

  const revalidarEn = typeof token.revalidarEn === "number" ? token.revalidarEn : 0
  if (revalidarEn > ahoraSeg) return token

  const validUser = await validateRefreshToken(token.refreshToken)

  if (!validUser) {
    console.log(`[Auth] Refresh token invalid, session expired`)
    return { ...token, error: "RefreshTokenExpired" }
  }

  const actualizado: TokenSesion = { ...token, revalidarEn: ahoraSeg + REVALIDAR_CADA_SEG }

  // Nombre, rol y sucursal se resincronizan desde la base: el rol es lo que
  // leen requireAdmin() y los guards de la API, y va junto con la sucursal
  // para no romper el invariante del CHECK de la 241
  // (`rol = 'ADMIN' OR sucursal_id IS NOT NULL`). Un rol fuera del enum deja
  // el token como estaba en lugar de firmar cualquier cosa.
  if (validUser.nombre) actualizado.name = validUser.nombre
  const rol = validUser.rol as string | undefined
  if (rol === "ADMIN" || rol === "TECNICO" || rol === "VENDEDOR") {
    actualizado.role = rol
  }
  actualizado.sucursalId = (validUser.sucursal_id as string | null) ?? null

  return actualizado as T
}
