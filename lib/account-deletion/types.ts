// Tipos compartidos entre las rutas /api/account/* y la UI. Sin imports de servidor.

export interface ReauthInput {
  /** Usuarios `credentials`. */
  password?: string
  /** Usuarios `google` (sin password): tipean su email. */
  email?: string
  /** Solo si el usuario tiene 2FA activo. */
  totpCode?: string
}

export interface DeletionInfo {
  role: "ADMIN" | "TECNICO" | "VENDEDOR"
  slug: string
  orgName: string
  /** ADMIN sin otro ADMIN activo en el taller: no puede borrar solo su usuario. */
  isLastAdmin: boolean
  hasPassword: boolean
  totpEnabled: boolean
  graceDays: number
}
