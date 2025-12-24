import { DefaultSession } from "next-auth"

type Rol = "ADMIN" | "TECNICO"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      role: Rol
    } & DefaultSession["user"]
  }

  interface User {
    role: Rol
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: Rol
    id: string
  }
}

