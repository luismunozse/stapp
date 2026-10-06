// Constantes y predicados puros de la eliminación de cuenta. Sin imports de
// servidor: lo consumen auth, middleware (Edge), rutas, cron y UI.

/** Días entre el pedido y el borrado definitivo. */
export const GRACE_DAYS = 30

/** Dominio reservado (.invalid, RFC 2606): nunca puede recibir correo. */
export const ANON_EMAIL_DOMAIN = "deleted.stapp.invalid"
export const ANON_NAME = "Usuario eliminado"

/** Valor de organizations.archived_reason cuando el pedido lo hizo el taller. */
export const DELETION_REASON = "user_requested_deletion"

export function anonymizedEmail(userId: string): string {
  return `deleted+${userId}@${ANON_EMAIL_DOMAIN}`
}

export function isAnonymizedEmail(email: string | null | undefined): boolean {
  return !!email && email.endsWith(`@${ANON_EMAIL_DOMAIN}`)
}

/** Fecha en que vence la gracia de un pedido hecho en `from`. */
export function graceEndsAt(from: Date | string): Date {
  const d = new Date(from)
  d.setUTCDate(d.getUTCDate() + GRACE_DAYS)
  return d
}

/** Pedidos hechos antes de esta fecha ya cumplieron la gracia. */
export function graceCutoff(now: Date = new Date()): Date {
  const d = new Date(now)
  d.setUTCDate(d.getUTCDate() - GRACE_DAYS)
  return d
}

export function isUserDeleted(u: { deleted_at?: string | null } | null | undefined): boolean {
  return !!u?.deleted_at
}

export function isOrgDeleted(o: { deleted_at?: string | null } | null | undefined): boolean {
  return !!o?.deleted_at
}
