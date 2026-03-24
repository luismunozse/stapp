import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { supabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"
import { randomBytes } from "crypto"

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
        skip2FA: { label: "Skip 2FA check", type: "text" },
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
          }
        }

        // Modo 2: Autenticación tradicional con email/password
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
          return null
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
          return null
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        )

        if (!isPasswordValid) {
          return null
        }

        // Verificar si tiene 2FA activado
        if (user.totp_enabled && credentials.skip2FA !== "true") {
          // Lanzar error especial para que el frontend muestre el paso de 2FA
          throw new Error(`REQUIRES_2FA:${user.id}`)
        }

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
        }
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user, trigger }) => {
      // Login inicial
      if (user && user.id) {
        token.role = user.role
        token.id = user.id
        token.organizationId = user.organizationId
        token.isSuperadmin = user.isSuperadmin
        token.rememberMe = user.rememberMe
        token.refreshToken = user.refreshToken
        // JWT expira en 1 día, pero se refresca automáticamente
        token.exp = Math.floor(Date.now() / 1000) + ONE_DAY
        token.iat = Math.floor(Date.now() / 1000)
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
