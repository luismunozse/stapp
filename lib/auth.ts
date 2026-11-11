import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { sanitizeName, sanitizeAvatarUrl } from "@/lib/sanitize-profile"

// NextAuth v5: cuando authorize() tira `throw new Error("CODE")`, el mensaje
// queda atrapado dentro de CallbackRouteError y el cliente nunca lo ve — recibe
// solo "CallbackRouteError" en result.error. Para propagar el código al cliente
// hay que tirar una subclase de CredentialsSignin con `code`: el framework
// pasa ese code como query param `?code=` y el cliente lo lee en `result.code`.
// Usamos el code como string serializado para preservar el patrón "CODE:payload"
// usado en el codebase (ej. REQUIRES_2FA:userId).
class AuthSigninError extends CredentialsSignin {
  constructor(code: string) {
    super()
    this.code = code
  }
}
import { supabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"
import { verifyGoogleIdToken } from "@/lib/google"
import { cambiosAlVerificarConGoogle } from "@/lib/google-account"
import { logLoginEvent, logLogoutEvent } from "@/lib/superadmin-audit"
import { verifyUserTotpCode } from "@/lib/totp"
import { isUserDeleted, isLoginBlocked } from "@/lib/account-deletion/state"
import { sessionCookieDomain, sessionCookieName } from "@/lib/session-cookie"
import {
  isSuperadminEmail,
  esSuperadmin,
  saveRefreshToken,
  validateRefreshToken,
  invalidateRefreshToken,
  revocarRefreshToken,
  rotarRefreshToken,
  revalidarTokenSesion,
  REVALIDAR_CADA_SEG,
} from "@/lib/auth-tokens"

type Rol = "ADMIN" | "TECNICO" | "VENDEDOR"

// Duraciones de sesión
const THIRTY_DAYS = 30 * 24 * 60 * 60 // 30 días en segundos

// Dominio de cookies derivado automáticamente en producción para que la sesión
// se comparta entre todos los subdominios. La regla (y el nombre de la cookie de
// sesión) viven en lib/session-cookie.ts, compartidas con el middleware y con
// requireAuth(), que no pueden importar este archivo.
const COOKIE_DOMAIN = sessionCookieDomain()

// Refresh tokens: una fila por sesión en `refresh_tokens` (lib/auth-tokens.ts).
export { validateRefreshToken, invalidateRefreshToken, revocarRefreshToken } from "@/lib/auth-tokens"

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Auth.js loguea cada CredentialsSignin (password incorrecta, REQUIRES_2FA,
  // EMAIL_NOT_VERIFIED, GOOGLE_NO_ACCOUNT...) como `[auth][error]` con stack
  // completo apuntando a authorize(). Son resultados esperados del login, no
  // fallas: los bajamos a una línea de warn con el código y dejamos el log de
  // error para lo que realmente rompe (CallbackRouteError, config, etc.).
  logger: {
    error(error) {
      const e = error as Error & { type?: string; code?: string; cause?: unknown }
      if (e instanceof CredentialsSignin || e.type === "CredentialsSignin") {
        // REQUIRES_2FA:<userId> → no loguear el userId
        const code = (e.code || "credentials").split(":")[0]
        console.warn(`[auth][signin-rejected] ${code}`)
        return
      }
      console.error(`[auth][error] ${e.name}: ${e.message}`)
      const cause = (e.cause as { err?: unknown } | undefined)?.err ?? e.cause
      console.error(cause instanceof Error ? cause : e)
    },
  },
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
              sucursal_id,
              avatar_url,
              es_superadmin,
              organizations (
                id,
                activo,
                deleted_at
              )
            `)
            .eq("id", validUser.id)
            .single()

          if (userError || !fullUser) {
            return null
          }

          // Verificar si es superadmin
          const isSuper = esSuperadmin(fullUser)

          // Verificar organización activa (no requerido para superadmin)
          const orgs = fullUser.organizations as unknown
          const organization = Array.isArray(orgs) ? orgs[0] : orgs
          if (isLoginBlocked(validUser, organization as { activo: boolean; deleted_at?: string | null } | null, { isSuper })) {
            return null
          }

          // Rotar: el token usado deja de servir y la sesión sigue con uno nuevo.
          const newRefreshToken = await rotarRefreshToken(credentials.pwaRefreshToken as string, fullUser.id)

          return {
            id: fullUser.id,
            email: fullUser.email,
            name: fullUser.nombre,
            role: fullUser.rol as Rol,
            organizationId: fullUser.organization_id,
            sucursalId: (fullUser.sucursal_id ?? null),
            isSuperadmin: isSuper,
            rememberMe: true,
            refreshToken: newRefreshToken,
            avatar: fullUser.avatar_url || null,
          }
        }

        // Modo 2: Autenticación con Google ID Token
        if (credentials?.googleIdToken) {
          const googleUser = await verifyGoogleIdToken(credentials.googleIdToken as string)
          // Google ya devuelve el email en lowercase per spec, pero normalizamos
          // por consistencia con el resto de los lookups.
          const googleEmailNormalized = googleUser.email.trim().toLowerCase()

          // Buscar usuario por email
          const { data: gUser, error: gError } = await supabaseAdmin
            .from("users")
            .select(`
              *,
              organizations (
                id,
                activo,
                deleted_at
              )
            `)
            .eq("email", googleEmailNormalized)
            .single()

          if (gError || !gUser) {
            throw new AuthSigninError("GOOGLE_NO_ACCOUNT")
          }

          // Baja en período de gracia: se comporta como cuenta inexistente.
          if (isUserDeleted(gUser)) {
            throw new AuthSigninError("GOOGLE_NO_ACCOUNT")
          }

          // Google verificó el email (verifyGoogleIdToken lo exige). Si la cuenta
          // no lo estaba, se marca verificada y se descartan la contraseña y las
          // sesiones que pudo dejar quien la registró (ver lib/google-account).
          const cambiosGoogle = cambiosAlVerificarConGoogle(gUser)
          if (cambiosGoogle) {
            const { error: verifError } = await supabaseAdmin
              .from("users")
              .update(cambiosGoogle)
              .eq("id", gUser.id)
            if (verifError) throw verifError
          }

          // Mismo bloqueo por intentos fallidos que el login con contraseña:
          // sin esto el código 2FA se podía probar sin límite por esta vía.
          if (gUser.locked_until && new Date(gUser.locked_until) > new Date()) {
            throw new AuthSigninError("ACCOUNT_LOCKED")
          }

          // Verificar si es superadmin
          const isGoogleSuper = esSuperadmin(gUser)

          // Verificar que la organización esté activa
          const gOrg = gUser.organizations as { id: string; activo: boolean; deleted_at?: string | null } | null
          // Google ya probó la identidad, así que podemos decir el motivo real
          // en vez de devolver null (que el cliente muestra como error genérico).
          if (isLoginBlocked(gUser, gOrg, { isSuper: isGoogleSuper })) {
            throw new AuthSigninError("ORG_INACTIVE")
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
              throw new AuthSigninError(`REQUIRES_2FA:${gUser.id}`)
            }
            const totpResult = await verifyUserTotpCode(gUser.id, providedCode)
            if (!totpResult.valid) {
              Promise.resolve(supabaseAdmin.rpc("handle_failed_login", { p_email: gUser.email })).catch(() => {})
              throw new AuthSigninError("INVALID_2FA_CODE")
            }
          }

          // Forzar 2FA para superadmin con Google login
          if (isGoogleSuper && !gUser.totp_enabled) {
            throw new AuthSigninError("SUPERADMIN_REQUIRES_2FA_SETUP")
          }

          Promise.resolve(supabaseAdmin.rpc("reset_failed_login", { p_email: gUser.email })).catch(() => {})

          const rememberMe = credentials.rememberMe === "true"
          const refreshToken = await saveRefreshToken(gUser.id, rememberMe)

          return {
            id: gUser.id,
            email: gUser.email,
            name: gUser.nombre,
            role: gUser.rol as Rol,
            organizationId: gUser.organization_id,
            sucursalId: (gUser.sucursal_id ?? null),
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

        // Normalizamos el email a lowercase+trim porque `.eq()` de PostgREST es
        // case-sensitive. Sin esto, un usuario que se registró como
        // "kompucel@gmail.com" y tipea "Kompucel@gmail.com" (autocaps de mobile)
        // no se encuentra en la query y ve "Credenciales incorrectas".
        const normalizedEmail = (credentials.email as string).trim().toLowerCase()

        // Buscar usuario con su organización
        const { data: user, error } = await supabaseAdmin
          .from("users")
          .select(`
            *,
            organizations (
              id,
              activo,
              deleted_at
            )
          `)
          .eq("email", normalizedEmail)
          .single()

        if (error || !user) {
          // Log login fallido - usuario no encontrado
          logLoginEvent({
            email: normalizedEmail,
            success: false,
            isSuperadmin: isSuperadminEmail(normalizedEmail),
            reason: "Usuario no encontrado",
          }).catch(() => {})
          return null
        }

        // Baja en período de gracia: mismo resultado que una credencial inválida,
        // sin revelar que la cuenta existe.
        if (isUserDeleted(user)) {
          logLoginEvent({
            userId: user.id,
            email: user.email,
            success: false,
            isSuperadmin: isSuperadminEmail(user.email),
            reason: "Usuario eliminado",
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
          throw new AuthSigninError("ACCOUNT_LOCKED")
        }

        // Verificar que el email esté verificado
        if (!user.email_verified) {
          throw new AuthSigninError("EMAIL_NOT_VERIFIED")
        }

        // Verificar si es superadmin (email en la lista + fila marcada, 395)
        const isSuper = esSuperadmin(user)

        // Verificar que la organización esté activa (no requerido para superadmin)
        const organization = user.organizations as { id: string; activo: boolean; deleted_at?: string | null } | null
        if (isLoginBlocked(user, organization, { isSuper })) {
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
          throw new AuthSigninError("USE_GOOGLE_LOGIN")
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
            throw new AuthSigninError(`REQUIRES_2FA:${user.id}`)
          }
          const totpResult = await verifyUserTotpCode(user.id, providedCode)
          if (!totpResult.valid) {
            // Incrementar intentos fallidos para account lockout: un 2FA inválido
            // es un intento de login fallido. Sin esto, con la password correcta se
            // podían rociar los 10^6 códigos TOTP sin que la cuenta se bloqueara.
            Promise.resolve(supabaseAdmin.rpc("handle_failed_login", { p_email: user.email })).catch(() => {})
            // Loguear como intento fallido (cuenta correcta, segundo factor inválido)
            logLoginEvent({
              userId: user.id,
              email: user.email,
              success: false,
              isSuperadmin: isSuper,
              reason: "Código 2FA inválido",
            }).catch(() => {})
            throw new AuthSigninError("INVALID_2FA_CODE")
          }
        }

        // Forzar 2FA para superadmin: si no tiene 2FA activado, exigir que lo configure
        if (isSuper && !user.totp_enabled) {
          throw new AuthSigninError("SUPERADMIN_REQUIRES_2FA_SETUP")
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
          sucursalId: (user.sucursal_id ?? null),
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
        token.sucursalId = user.sucursalId ?? null
        token.isSuperadmin = user.isSuperadmin
        token.rememberMe = user.rememberMe
        token.refreshToken = user.refreshToken
        token.avatar = user.avatar
        // Próxima revalidación contra la base (ver revalidarTokenSesion).
        token.revalidarEn = Math.floor(Date.now() / 1000) + REVALIDAR_CADA_SEG
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
          const safeName = sanitizeName(sessionData.name)
          if (safeName) token.name = safeName
        }
        if (sessionData && "avatar" in sessionData) {
          // sanitizeAvatarUrl returns null for javascript:, data:, etc.
          token.avatar = sanitizeAvatarUrl(sessionData.avatar) ?? null
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
        // El cliente llama update() cada pocos minutos: la revalidación
        // periódica tiene que correr también por este camino.
        return revalidarTokenSesion(token)
      }

      // Revalidación periódica: refresh token vigente, rol y sucursal al día.
      return revalidarTokenSesion(token)
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.role = token.role as Rol
        session.user.id = token.id as string
        session.user.organizationId = token.organizationId as string
        session.user.sucursalId = (token.sucursalId as string | null) ?? null
        session.user.isSuperadmin = token.isSuperadmin as boolean
        session.user.avatar = token.avatar as string | null
        // Surface impersonation state so the dashboard can render the banner
        // and read-only affordances. These are only present on minted
        // impersonation tokens (lib/impersonation.ts), never on real logins.
        session.user.isImpersonating = (token.isImpersonating as boolean) || false
        session.user.impersonatorEmail = (token.impersonatorEmail as string | null) ?? null
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
      // NUNCA invalidar nada durante una sesión de impersonación: `token.id`
      // acá es el usuario DEL TENANT (no el superadmin). Invalidar su refresh
      // token lo desloguearía de su PWA/sesiones reales — una escritura con
      // efecto visible que rompería el contrato read-only + silencioso de la
      // impersonación. El camino sancionado para terminar es /api/auth/impersonate/exit.
      if ("token" in message && (message.token as { isImpersonating?: boolean })?.isImpersonating) {
        return
      }
      // Logout: se revoca solo la sesión de este dispositivo.
      if ("token" in message && message.token?.id) {
        if (typeof message.token.refreshToken === "string") {
          await revocarRefreshToken(message.token.refreshToken)
        }
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
      name: sessionCookieName(),
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
