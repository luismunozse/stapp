import { DefaultSession } from "next-auth"

type Rol = "ADMIN" | "TECNICO" | "VENDEDOR"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      role: Rol
      organizationId: string
      isSuperadmin?: boolean
    } & DefaultSession["user"]
    error?: string
  }

  interface User {
    role: Rol
    organizationId: string
    isSuperadmin?: boolean
    rememberMe?: boolean
    refreshToken?: string
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: Rol
    id: string
    organizationId: string
    isSuperadmin?: boolean
    rememberMe?: boolean
    refreshToken?: string
    error?: string
  }
}

