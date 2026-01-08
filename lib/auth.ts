import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { supabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"

type Rol = "ADMIN" | "TECNICO" | "VENDEDOR"

// Duraciones de sesión
const ONE_DAY = 24 * 60 * 60 // 1 día en segundos
const THIRTY_DAYS = 30 * 24 * 60 * 60 // 30 días en segundos

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
        rememberMe: { label: "Recordarme", type: "text" },
      },
      authorize: async (credentials) => {
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

        // Verificar que la organización esté activa
        const organization = user.organizations as { id: string; activo: boolean }
        if (!organization?.activo) {
          return null
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        )

        if (!isPasswordValid) {
          return null
        }

        // Pasar rememberMe al token
        const rememberMe = credentials.rememberMe === "true"

        return {
          id: user.id,
          email: user.email,
          name: user.nombre,
          role: user.rol as Rol,
          organizationId: user.organization_id,
          rememberMe,
        }
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user && user.id) {
        token.role = user.role
        token.id = user.id
        token.organizationId = user.organizationId
        token.rememberMe = user.rememberMe
        // Establecer expiración basada en rememberMe
        const maxAge = user.rememberMe ? THIRTY_DAYS : ONE_DAY
        token.exp = Math.floor(Date.now() / 1000) + maxAge
      }
      return token
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.role = token.role as Rol
        session.user.id = token.id as string
        session.user.organizationId = token.organizationId as string
      }
      return session
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: THIRTY_DAYS, // Máximo 30 días, pero el JWT controla la expiración real
  },
  // Cookies configuradas para funcionar en todos los subdominios
  // Solo usar dominio personalizado si está configurado COOKIE_DOMAIN
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
        // Solo establecer dominio si hay COOKIE_DOMAIN configurado (para subdominios)
        domain: process.env.COOKIE_DOMAIN || undefined,
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
        domain: process.env.COOKIE_DOMAIN || undefined,
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
