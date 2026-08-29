/**
 * Validacion del destino antes de gastar un envio.
 *
 * En prod el 52% de los telefonos guardados tiene 8 digitos: es el numero local
 * sin codigo de area. `formatPhoneForCountry` le antepone el codigo de pais y
 * produce algo como 54 + 8 digitos, que no le llega a nadie; Evolution responde
 * "Bad Request" y el taller ve un fallo sin motivo. Chequear antes evita el
 * viaje al proveedor y, sobre todo, deja dicho que hay que corregir.
 *
 * Es a proposito conservador: solo rechaza lo que con certeza no se puede
 * entregar (sin digitos, o menos digitos que el minimo del pais). Nunca rechaza
 * por ser largo, porque un falso positivo deja a un cliente real sin aviso.
 */
import { getCountryConfig } from "@/lib/countries"

export type ResultadoDestino = { valido: true } | { valido: false; motivo: string }

export function validarDestinoWhatsApp(
  phone: string | null | undefined,
  countryCode?: string | null
): ResultadoDestino {
  const country = getCountryConfig(countryCode)
  const digitos = String(phone ?? "").replace(/\D/g, "")

  if (!digitos) {
    return { valido: false, motivo: "Sin teléfono cargado en la ficha del cliente." }
  }

  // El 0 de larga distancia no forma parte del numero.
  let nacional = digitos.replace(/^0+/, "")
  const min = country.phoneNationalMinDigits

  // Solo tratamos el prefijo como codigo de pais si lo que queda sigue siendo
  // un numero plausible; si no, es parte del numero nacional.
  if (
    nacional.startsWith(country.phoneCode) &&
    nacional.length - country.phoneCode.length >= min
  ) {
    nacional = nacional.slice(country.phoneCode.length)
  }

  if (nacional.length < min) {
    return {
      valido: false,
      motivo: `El teléfono tiene ${nacional.length} dígitos y ${country.name} necesita al menos ${min} (falta el código de área). Corregilo en la ficha del cliente.`,
    }
  }

  return { valido: true }
}
