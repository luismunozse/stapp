import { DefaultSession } from "next-auth"

type Rol = "ADMIN" | "TECNICO" | "VENDEDOR"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      role: Rol
      organizationId: string
    } & DefaultSession["user"]
    error?: string
  }

  interface User {
    role: Rol
    organizationId: string
    rememberMe?: boolean
    refreshToken?: string
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: Rol
    id: string
    organizationId: string
    rememberMe?: boolean
    refreshToken?: string
    error?: string
  }
}

