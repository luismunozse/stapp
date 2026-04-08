import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { supabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"
import { randomBytes } from "crypto"
import { verifyGoogleIdToken } from "@/lib/google"
import { logLoginEvent, logLogoutEvent } from "@/lib/superadmin-audit"
import { verifyUserTotpCode } from "@/lib/totp"

type Rol = "ADMIN" | "TECNICO" | "VENDEDOR"

// Verificar si un email es superadmin (desde env)
function isSuperadminEmail(email: string): boolean {
  const superadminEmails =
    process.env.SUPERADMIN_EMAILS?.split(",").map((e) => e.trim().toLowerCase()) || []
  return superadminEmails.includes(email.toLowerCase())
}

// Duraciones de sesión
const ONE_DAY = 24 * 60 * 60 // 1 día en segundos
const SEVEN_DAYS = 7 * 24 * 60 * 60 // 7 días en segundos
const THIRTY_DAYS = 30 * 24 * 60 * 60 // 30 días en segundos

// Tiempo antes de expiración para refrescar automáticamente (6 horas antes)
const REFRESH_THRESHOLD = 6 * 60 * 60

// Derivar dominio de cookies automáticamente en producción
// para que la sesión se comparta entre todos los subdominios
function getCookieDomain(): string | undefined {
  if (process.env.COOKIE_DOMAIN) return process.env.COOKIE_DOMAIN
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ROOT_DOMAIN) {
    return `.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`
  }
  return undefined
}
const COOKIE_DOMAIN = getCookieDomain()

// Genera un refresh token único
function generateRefreshToken(): string {
  return randomBytes(64).toString("hex")
}

// Guarda el refresh token en la base de datos
async function saveRefreshToken(userId: string, rememberMe: boolean): Promise<string> {
  const refreshToken = generateRefreshToken()
  const expiresAt = new Date()
  expiresAt.setSeconds(expiresAt.getSeconds() + (rememberMe ? THIRTY_DAYS : SEVEN_DAYS))

  await supabaseAdmin
    .from("users")
    .update({
      refresh_token: refreshToken,
      refresh_token_expires: expiresAt.toISOString(),
    })
    .eq("id", userId)

  return refreshToken
}

// Valida y obtiene usuario por refresh token
export async function validateRefreshToken(refreshToken: string) {
  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select(`
      id,
      email,
      nombre,
      rol,
      organization_id,
      refresh_token_expires,
      organizations (id, activo)
    `)
    .eq("refresh_token", refreshToken)
    .single()

  if (error || !user) return null

  // Verificar que no haya expirado
  const expires = new Date(user.refresh_token_expires)
  if (expires < new Date()) {
    // Limpiar refresh token expirado
    await supabaseAdmin
      .from("users")
      .update({ refresh_token: null, refresh_token_expires: null })
      .eq("id", user.id)
    return null
  }

  // Verificar organización activa (no requerido para superadmin)
  const orgs = user.organizations as unknown
  const org = Array.isArray(orgs) ? orgs[0] : orgs
  if (!isSuperadminEmail(user.email) && (!org || !(org as { activo: boolean }).activo)) return null

  return user
}

// Rota el refresh token (genera uno nuevo)
export async function rotateRefreshToken(userId: string, rememberMe: boolean): Promise<string> {
  return saveRefreshToken(userId, rememberMe)
}

// Invalida el refresh token (logout)
export async function invalidateRefreshToken(userId: string): Promise<void> {
  await supabaseAdmin
    .from("users")
    .update({ refresh_token: null, refresh_token_expires: null })
    .eq("id", userId)
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
        rememberMe: { label: "Recordarme", type: "text" },
        pwaRefreshToken: { label: "PWA Refresh Token", type: "text" },
        totpCode: { label: "Codigo 2FA", type: "text" },
        googleIdToken: { label: "Google ID Token", type: "text" },
      },
      authorize: async (credentials) => {
        // Modo 1: Autenticación con refresh token (para PWA)
        if (credentials?.pwaRefreshToken) {
          const validUser = await validateRefreshToken(credentials.pwaRefreshToken as string)

          if (!validUser) {
            return null
          }

          // Obtener datos completos del usuario
          const { data: fullUser, error: userError } = await supabaseAdmin
            .from("users")
            .select(`
              id,
              email,
              nombre,
              rol,
              organization_id,
              avatar_url,
              organizations (
                id,
                activo
              )
            `)
            .eq("id", validUser.id)
            .single()

          if (userError || !fullUser) {
            return null
          }

          // Verificar si es superadmin
          const isSuper = isSuperadminEmail(fullUser.email)

          // Verificar organización activa (no requerido para superadmin)
          const orgs = fullUser.organizations as unknown
          const organization = Array.isArray(orgs) ? orgs[0] : orgs
          if (!isSuper && (!organization || !(organization as { activo: boolean }).activo)) {
            return null
          }

          // Rotar el refresh token
          const newRefreshToken = await saveRefreshToken(fullUser.id, true)

          return {
            id: fullUser.id,
            email: fullUser.email,
            name: fullUser.nombre,
            role: fullUser.rol as Rol,
            organizationId: fullUser.organization_id,
            isSuperadmin: isSuper,
            rememberMe: true,
            refreshToken: newRefreshToken,
            avatar: fullUser.avatar_url || null,
          }
        }

        // Modo 2: Autenticación con Google ID Token
        if (credentials?.googleIdToken) {
          const googleUser = await verifyGoogleIdToken(credentials.googleIdToken as string)

          // Buscar usuario por email
          const { data: gUser, error: gError } = await supabaseAdmin
            .from("users")
            .select(`
              *,
              organizations (
                id,
                activo
              )
            `)
            .eq("email", googleUser.email)
            .single()

          if (gError || !gUser) {
            throw new Error("GOOGLE_NO_ACCOUNT")
          }

          // Google ya verificó el email, marcar como verificado si no lo está
          if (!gUser.email_verified) {
            await supabaseAdmin
              .from("users")
              .update({ email_verified: true, email_verification_token: null, email_verification_expires: null })
              .eq("id", gUser.id)
          }

          // Verificar si es superadmin
          const isGoogleSuper = isSuperadminEmail(gUser.email)

          // Verificar que la organización esté activa
          const gOrg = gUser.organizations as { id: string; activo: boolean } | null
          if (!isGoogleSuper && !gOrg?.activo) {
            return null
          }

          // Verificar 2FA. La validación es server-side: si el usuario tiene
          // 2FA activado, exigimos un `totpCode` válido en este mismo request.
          // No confiamos en ningún flag del cliente — antes se trustaba
          // `skip2FA: "true"` y eso permitía bypass conociendo email+password.
          if (gUser.totp_enabled) {
            const providedCode = credentials.totpCode
              ? String(credentials.totpCode)
              : ""
            if (!providedCode) {
              // Aún no envió código: pedir el segundo factor
              throw new Error(`REQUIRES_2FA:${gUser.id}`)
            }
            const totpResult = await verifyUserTotpCode(gUser.id, providedCode)
            if (!totpResult.valid) {
              throw new Error("INVALID_2FA_CODE")
            }
          }

          // Forzar 2FA para superadmin con Google login
          if (isGoogleSuper && !gUser.totp_enabled) {
            throw new Error("SUPERADMIN_REQUIRES_2FA_SETUP")
          }

          const rememberMe = credentials.rememberMe === "true"
          const refreshToken = await saveRefreshToken(gUser.id, rememberMe)

          return {
            id: gUser.id,
            email: gUser.email,
            name: gUser.nombre,
            role: gUser.rol as Rol,
            organizationId: gUser.organization_id,
            isSuperadmin: isGoogleSuper,
            rememberMe,
            refreshToken,
            avatar: gUser.avatar_url || null,
          }
        }

        // Modo 3: Autenticación tradicional con email/password
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        // Buscar usuario con su organización
        const { data: user, error } = await supabaseAdmin
          .from("users")
          .select(`
            *,
            organizations (
              id,
              activo
            )
          `)
          .eq("email", credentials.email as string)
          .single()

        if (error || !user) {
          // Log login fallido - usuario no encontrado
          logLoginEvent({
            email: credentials.email as string,
            success: false,
            isSuperadmin: isSuperadminEmail(credentials.email as string),
            reason: "Usuario no encontrado",
          }).catch(() => {})
          return null
        }

        // Verificar account lockout
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
          logLoginEvent({
            userId: user.id,
            email: user.email,
            success: false,
            isSuperadmin: isSuperadminEmail(user.email),
            reason: "Cuenta bloqueada por intentos fallidos",
          }).catch(() => {})
          throw new Error("ACCOUNT_LOCKED")
        }

        // Verificar que el email esté verificado
        if (!user.email_verified) {
          throw new Error("EMAIL_NOT_VERIFIED")
        }

        // Verificar si es superadmin
        const isSuper = isSuperadminEmail(user.email)

        // Verificar que la organización esté activa (no requerido para superadmin)
        const organization = user.organizations as { id: string; activo: boolean } | null
        if (!isSuper && !organization?.activo) {
          logLoginEvent({
            userId: user.id,
            email: user.email,
            success: false,
            isSuperadmin: isSuper,
            reason: "Organización inactiva",
          }).catch(() => {})
          return null
        }

        // Verificar password (puede ser null si el usuario se registró con Google)
        if (!user.password) {
          throw new Error("USE_GOOGLE_LOGIN")
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        )

        if (!isPasswordValid) {
          // Incrementar intentos fallidos para account lockout
          Promise.resolve(supabaseAdmin.rpc("handle_failed_login", { p_email: user.email })).catch(() => {})
          // Log login fallido - contraseña incorrecta
          logLoginEvent({
            userId: user.id,
            email: user.email,
            success: false,
            isSuperadmin: isSuper,
            reason: "Contraseña incorrecta",
          }).catch(() => {})
          return null
        }

        // Verificar si tiene 2FA activado. La verificación corre server-side
        // dentro de este authorize(): si el usuario tiene 2FA, exigimos que el
        // cliente envíe un `totpCode` válido en este mismo request. Antes se
        // trustaba el flag `skip2FA: "true"` enviado por el cliente, lo que
        // permitía bypasear 2FA conociendo email+password.
        if (user.totp_enabled) {
          const providedCode = credentials.totpCode
            ? String(credentials.totpCode)
            : ""
          if (!providedCode) {
            // Lanzar error especial para que el frontend muestre el paso de 2FA
            throw new Error(`REQUIRES_2FA:${user.id}`)
          }
          const totpResult = await verifyUserTotpCode(user.id, providedCode)
          if (!totpResult.valid) {
            // Loguear como intento fallido (cuenta correcta, segundo factor inválido)
            logLoginEvent({
              userId: user.id,
              email: user.email,
              success: false,
              isSuperadmin: isSuper,
              reason: "Código 2FA inválido",
            }).catch(() => {})
            throw new Error("INVALID_2FA_CODE")
          }
        }

        // Forzar 2FA para superadmin: si no tiene 2FA activado, exigir que lo configure
        if (isSuper && !user.totp_enabled) {
          throw new Error("SUPERADMIN_REQUIRES_2FA_SETUP")
        }

        // Resetear intentos fallidos y log login exitoso
        Promise.resolve(supabaseAdmin.rpc("reset_failed_login", { p_email: user.email })).catch(() => {})
        logLoginEvent({
          userId: user.id,
          email: user.email,
          success: true,
          isSuperadmin: isSuper,
        }).catch(() => {})

        // Pasar rememberMe al token
        const rememberMe = credentials.rememberMe === "true"

        // Generar y guardar refresh token
        const refreshToken = await saveRefreshToken(user.id, rememberMe)

        return {
          id: user.id,
          email: user.email,
          name: user.nombre,
          role: user.rol as Rol,
          organizationId: user.organization_id,
          isSuperadmin: isSuper,
          rememberMe,
          refreshToken,
          avatar: user.avatar_url || null,
        }
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user, trigger, session }) => {
      // Login inicial
      if (user && user.id) {
        token.role = user.role
        token.id = user.id
        token.organizationId = user.organizationId
        token.isSuperadmin = user.isSuperadmin
        token.rememberMe = user.rememberMe
        token.refreshToken = user.refreshToken
        token.avatar = user.avatar
        // JWT expira en 1 día, pero se refresca automáticamente
        token.exp = Math.floor(Date.now() / 1000) + ONE_DAY
        token.iat = Math.floor(Date.now() / 1000)
        return token
      }

      // Refrescar datos del usuario cuando se llama update() desde el cliente.
      // Soportamos dos formas:
      //   1. update({ name, avatar }) — usa los datos pasados directamente.
      //      Esto evita una ida a la BD y es más confiable porque no depende
      //      de que el cliente y el server vean el mismo estado de la BD en
      //      el mismo instante (read-after-write).
      //   2. update() sin args — refetch desde la BD como fallback.
      if (trigger === "update" && token.id) {
        const sessionData = session as { name?: string; avatar?: string | null } | undefined

        if (sessionData?.name) {
          token.name = sessionData.name
        }
        if (sessionData && "avatar" in sessionData) {
          token.avatar = sessionData.avatar ?? null
        }

        // Si no vino data explícita (o vino incompleta), refetch desde BD
        if (!sessionData?.name) {
          const { data: freshUser } = await supabaseAdmin
            .from("users")
            .select("nombre, avatar_url")
            .eq("id", token.id as string)
            .single()

          if (freshUser) {
            token.name = freshUser.nombre
            if (!sessionData || !("avatar" in sessionData)) {
              token.avatar = freshUser.avatar_url || null
            }
          }
        }
        return token
      }

      // Verificar si necesita refresh (6 horas antes de expirar)
      const now = Math.floor(Date.now() / 1000)
      const exp = token.exp as number
      const timeUntilExpiry = exp - now

      if (timeUntilExpiry < REFRESH_THRESHOLD && token.refreshToken) {
        // Validar que el refresh token siga vigente (sin rotarlo).
        // No rotamos acá porque la PWA guarda el token en localStorage
        // y no puede sincronizar un token nuevo. Solo se rota en login/restore.
        const validUser = await validateRefreshToken(token.refreshToken as string)

        if (validUser) {
          // Extender el JWT sin rotar el refresh token
          token.exp = Math.floor(Date.now() / 1000) + ONE_DAY
          token.iat = Math.floor(Date.now() / 1000)

          // Aprovechar el refresh para sincronizar nombre y avatar desde la BD.
          // Esto cubre el caso en que el usuario actualizó su perfil pero el
          // trigger "update" de useSession() no llegó a re-firmar el cookie:
          // el JWT termina sincronizándose solo dentro de las próximas 6 horas
          // sin requerir re-login.
          token.name = (validUser as { nombre?: string }).nombre || token.name

          console.log(`[Auth] JWT extended for user ${validUser.id}`)
        } else {
          // Refresh token inválido o expirado, forzar re-login
          console.log(`[Auth] Refresh token invalid, session expired`)
          token.error = "RefreshTokenExpired"
        }
      }

      return token
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.role = token.role as Rol
        session.user.id = token.id as string
        session.user.organizationId = token.organizationId as string
        session.user.isSuperadmin = token.isSuperadmin as boolean
        session.user.avatar = token.avatar as string | null
      }

      // Pasar error al cliente si existe
      if (token.error) {
        session.error = token.error as string
      }

      return session
    },
  },
  events: {
    signOut: async (message) => {
      // Invalidar refresh token al hacer logout
      if ("token" in message && message.token?.id) {
        await invalidateRefreshToken(message.token.id as string)
        // Log logout event
        logLogoutEvent({
          userId: message.token.id as string,
          email: (message.token.email as string) || "",
          isSuperadmin: (message.token.isSuperadmin as boolean) || false,
        }).catch(() => {})
      }
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: THIRTY_DAYS, // Cookie dura 30 días, JWT se refresca automáticamente
  },
  // Cookies configuradas para funcionar en todos los subdominios
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-next-auth.session-token"
          : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        domain: COOKIE_DOMAIN,
      },
    },
    callbackUrl: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-next-auth.callback-url"
          : "next-auth-callback-url",
      options: {
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        domain: COOKIE_DOMAIN,
      },
    },
    csrfToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Host-next-auth.csrf-token"
          : "next-auth.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
})
