/**
 * Cambio de política "trial de 30 días con todo Premium" (commit 80aa9eaa,
 * migración 019_trial_subscription, desplegado el 2026-01-17).
 *
 * El aviso de PolicyChangeModal es para las cuentas que ya existían con el
 * modelo anterior. Una cuenta creada desde ese día aceptó la política vigente
 * al registrarse: mostrarle "cambiamos nuestras políticas" no tiene sentido
 * y le suma una capa más al primer ingreso (auditoría UX §5.1).
 */
export const FECHA_CAMBIO_POLITICA_TRIAL = new Date("2026-01-17T00:00:00-03:00")

/**
 * true sólo si la organización se creó antes del cambio de política.
 * Sin fecha (o fecha inválida) no se muestra: ante la duda, una capa menos.
 */
export function debeVerAvisoCambioPolitica(
  organizacionCreadaEn: string | Date | null | undefined
): boolean {
  if (!organizacionCreadaEn) return false
  const creada = new Date(organizacionCreadaEn)
  if (Number.isNaN(creada.getTime())) return false
  return creada.getTime() < FECHA_CAMBIO_POLITICA_TRIAL.getTime()
}
