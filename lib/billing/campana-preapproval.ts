/**
 * Quien recibe la invitacion a activar el debito automatico.
 *
 * Es una regla sobre a quien se le escribe: equivocarse manda un mail a quien
 * no corresponde, y eso no se puede deshacer. Va pura y con tests.
 */
export function esDestinatarioDeLaCampana(input: {
  /** Precio del plan actual. Cero o menos = plan gratis. */
  precioMensual: number
  tienePreapproval: boolean
  status: string
  yaRecibioElMail: boolean
}): boolean {
  // Una sola vez por organizacion.
  if (input.yaRecibioElMail) return false

  // Ya se cobra solo: no hay nada que invitarle.
  if (input.tienePreapproval) return false

  // El mensaje es para quien paga. En Free o en trial no aplica.
  if (input.precioMensual <= 0) return false
  if (input.status === "TRIALING") return false

  // PAST_DUE SI entra: es exactamente a quien mas le sirve dejar de depender
  // de acordarse. Que se haya atrasado es el sintoma que la campana ataca.
  return true
}
