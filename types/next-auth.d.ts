import { DefaultSession } from "next-auth"

type Rol = "ADMIN" | "TECNICO" | "VENDEDOR"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      role: Rol
      organizationId: string
      sucursalId: string | null
      isSuperadmin?: boolean
      avatar?: string | null
      // Set when a superadmin is impersonating this tenant (read-only session).
      isImpersonating?: boolean
      impersonatorEmail?: string | null
    } & DefaultSession["user"]
    error?: string
  }

  interface User {
    role: Rol
    organizationId: string
    sucursalId?: string | null
    isSuperadmin?: boolean
    rememberMe?: boolean
    refreshToken?: string
    avatar?: string | null
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: Rol
    id: string
    organizationId: string
    sucursalId?: string | null
    isSuperadmin?: boolean
    rememberMe?: boolean
    refreshToken?: string
    avatar?: string | null
    error?: string
    // Impersonation claims (minted in lib/impersonation.ts, never on real login).
    isImpersonating?: boolean
    impersonatorEmail?: string | null
  }
}
