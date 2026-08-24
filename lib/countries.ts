import type { CurrencyCode } from "./currency"

export type CountryCode =
  | "AR" | "MX" | "CL" | "CO" | "PE" | "UY" | "BR" | "BO" | "PY"
  | "VE" | "EC" | "CR" | "PA" | "DO" | "GT" | "HN" | "SV" | "NI" | "CU"

export interface CountryConfig {
  code: CountryCode
  name: string
  phoneCode: string
  defaultCurrency: CurrencyCode
  defaultTimezone: string
  locale: string
  /** Etiqueta del ID fiscal personal (ej: "DNI", "CI", "DPI") */
  personalIdLabel: string
  /** Regex para validar el ID fiscal personal */
  personalIdRegex: RegExp
  /** Placeholder para el campo de ID personal */
  personalIdPlaceholder: string
  /** Etiqueta del ID fiscal empresarial (ej: "CUIT", "RFC", "RUT") */
  taxIdLabel: string
  /** Regex para validar el ID fiscal empresarial */
  taxIdRegex: RegExp
  /** Placeholder para el campo de ID empresarial */
  taxIdPlaceholder: string
  /** Opciones de IVA comunes del país */
  ivaOptions: number[]
  /**
   * Tasa general de IVA del país, usada como valor por defecto cuando la org
   * todavía no configuró la suya. No es el máximo de `ivaOptions`: Argentina
   * ofrece 27% para servicios regulados pero su tasa general es 21%.
   */
  ivaGeneral: number
}

export const COUNTRIES: Record<CountryCode, CountryConfig> = {
  AR: {
    code: "AR",
    name: "Argentina",
    phoneCode: "54",
    defaultCurrency: "ARS",
    defaultTimezone: "America/Argentina/Buenos_Aires",
    locale: "es-AR",
    personalIdLabel: "DNI",
    personalIdRegex: /^(\d{7,8})?$/,
    personalIdPlaceholder: "12345678",
    taxIdLabel: "CUIT",
    taxIdRegex: /^(\d{2}-?\d{8}-?\d{1})?$/,
    taxIdPlaceholder: "20-12345678-9",
    ivaOptions: [0, 10.5, 21, 27],
    ivaGeneral: 21,
  },
  MX: {
    code: "MX",
    name: "México",
    phoneCode: "52",
    defaultCurrency: "MXN",
    defaultTimezone: "America/Mexico_City",
    locale: "es-MX",
    personalIdLabel: "CURP",
    personalIdRegex: /^[A-Z0-9]{0,18}$/,
    personalIdPlaceholder: "XXXX000000XXXXXX00",
    taxIdLabel: "RFC",
    taxIdRegex: /^[A-ZÑ&]{0,4}\d{0,6}[A-Z0-9]{0,3}$/,
    taxIdPlaceholder: "XAXX010101000",
    ivaOptions: [0, 8, 16],
    ivaGeneral: 16,
  },
  CL: {
    code: "CL",
    name: "Chile",
    phoneCode: "56",
    defaultCurrency: "CLP",
    defaultTimezone: "America/Santiago",
    locale: "es-CL",
    personalIdLabel: "RUT",
    personalIdRegex: /^(\d{1,2}\.?\d{3}\.?\d{3}-?[0-9kK])?$/,
    personalIdPlaceholder: "12.345.678-9",
    taxIdLabel: "RUT Empresa",
    taxIdRegex: /^(\d{1,2}\.?\d{3}\.?\d{3}-?[0-9kK])?$/,
    taxIdPlaceholder: "76.123.456-7",
    ivaOptions: [0, 19],
    ivaGeneral: 19,
  },
  CO: {
    code: "CO",
    name: "Colombia",
    phoneCode: "57",
    defaultCurrency: "COP",
    defaultTimezone: "America/Bogota",
    locale: "es-CO",
    personalIdLabel: "CC",
    personalIdRegex: /^(\d{6,10})?$/,
    personalIdPlaceholder: "1234567890",
    taxIdLabel: "NIT",
    taxIdRegex: /^(\d{9}-?\d{1})?$/,
    taxIdPlaceholder: "900123456-7",
    ivaOptions: [0, 5, 19],
    ivaGeneral: 19,
  },
  PE: {
    code: "PE",
    name: "Perú",
    phoneCode: "51",
    defaultCurrency: "PEN",
    defaultTimezone: "America/Lima",
    locale: "es-PE",
    personalIdLabel: "DNI",
    personalIdRegex: /^(\d{8})?$/,
    personalIdPlaceholder: "12345678",
    taxIdLabel: "RUC",
    taxIdRegex: /^(\d{11})?$/,
    taxIdPlaceholder: "20123456789",
    ivaOptions: [0, 18],
    ivaGeneral: 18,
  },
  UY: {
    code: "UY",
    name: "Uruguay",
    phoneCode: "598",
    defaultCurrency: "UYU",
    defaultTimezone: "America/Montevideo",
    locale: "es-UY",
    personalIdLabel: "CI",
    personalIdRegex: /^(\d{7,8})?$/,
    personalIdPlaceholder: "1234567",
    taxIdLabel: "RUT",
    taxIdRegex: /^(\d{12})?$/,
    taxIdPlaceholder: "211234560019",
    ivaOptions: [0, 10, 22],
    ivaGeneral: 22,
  },
  BR: {
    code: "BR",
    name: "Brasil",
    phoneCode: "55",
    defaultCurrency: "BRL",
    defaultTimezone: "America/Sao_Paulo",
    locale: "pt-BR",
    personalIdLabel: "CPF",
    personalIdRegex: /^(\d{3}\.?\d{3}\.?\d{3}-?\d{2})?$/,
    personalIdPlaceholder: "123.456.789-00",
    taxIdLabel: "CNPJ",
    taxIdRegex: /^(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})?$/,
    taxIdPlaceholder: "12.345.678/0001-90",
    ivaOptions: [0],
    ivaGeneral: 0,
  },
  BO: {
    code: "BO",
    name: "Bolivia",
    phoneCode: "591",
    defaultCurrency: "BOB",
    defaultTimezone: "America/La_Paz",
    locale: "es-BO",
    personalIdLabel: "CI",
    personalIdRegex: /^(\d{5,10})?$/,
    personalIdPlaceholder: "1234567",
    taxIdLabel: "NIT",
    taxIdRegex: /^(\d{1,15})?$/,
    taxIdPlaceholder: "123456789",
    ivaOptions: [0, 13],
    ivaGeneral: 13,
  },
  PY: {
    code: "PY",
    name: "Paraguay",
    phoneCode: "595",
    defaultCurrency: "PYG",
    defaultTimezone: "America/Asuncion",
    locale: "es-PY",
    personalIdLabel: "CI",
    personalIdRegex: /^(\d{5,10})?$/,
    personalIdPlaceholder: "1234567",
    taxIdLabel: "RUC",
    taxIdRegex: /^[0-9-]{0,15}$/,
    taxIdPlaceholder: "80012345-6",
    ivaOptions: [0, 5, 10],
    ivaGeneral: 10,
  },
  VE: {
    code: "VE",
    name: "Venezuela",
    phoneCode: "58",
    defaultCurrency: "USD",
    defaultTimezone: "America/Caracas",
    locale: "es-VE",
    personalIdLabel: "CI",
    personalIdRegex: /^[VEJPvejp]?-?\d{5,9}$/,
    personalIdPlaceholder: "V-12345678",
    taxIdLabel: "RIF",
    taxIdRegex: /^[JGVEPjgvep]-?\d{8}-?\d{1}$/,
    taxIdPlaceholder: "J-12345678-9",
    ivaOptions: [0, 16],
    ivaGeneral: 16,
  },
  EC: {
    code: "EC",
    name: "Ecuador",
    phoneCode: "593",
    defaultCurrency: "USD",
    defaultTimezone: "America/Guayaquil",
    locale: "es-EC",
    personalIdLabel: "CI",
    personalIdRegex: /^(\d{10})?$/,
    personalIdPlaceholder: "1234567890",
    taxIdLabel: "RUC",
    taxIdRegex: /^(\d{13})?$/,
    taxIdPlaceholder: "1234567890001",
    ivaOptions: [0, 12, 15],
    ivaGeneral: 15,
  },
  CR: {
    code: "CR",
    name: "Costa Rica",
    phoneCode: "506",
    defaultCurrency: "USD",
    defaultTimezone: "America/Costa_Rica",
    locale: "es-CR",
    personalIdLabel: "Cédula",
    personalIdRegex: /^(\d{9,12})?$/,
    personalIdPlaceholder: "123456789",
    taxIdLabel: "Cédula Jurídica",
    taxIdRegex: /^(\d{10,12})?$/,
    taxIdPlaceholder: "3101234567",
    ivaOptions: [0, 13],
    ivaGeneral: 13,
  },
  PA: {
    code: "PA",
    name: "Panamá",
    phoneCode: "507",
    defaultCurrency: "USD",
    defaultTimezone: "America/Panama",
    locale: "es-PA",
    personalIdLabel: "CIP",
    personalIdRegex: /^[0-9PE-]{0,15}$/,
    personalIdPlaceholder: "8-123-4567",
    taxIdLabel: "RUC",
    taxIdRegex: /^[0-9-DV]{0,20}$/,
    taxIdPlaceholder: "12345-67-890123",
    ivaOptions: [0, 7],
    ivaGeneral: 7,
  },
  DO: {
    code: "DO",
    name: "República Dominicana",
    phoneCode: "1",
    defaultCurrency: "USD",
    defaultTimezone: "America/Santo_Domingo",
    locale: "es-DO",
    personalIdLabel: "Cédula",
    personalIdRegex: /^(\d{3}-?\d{7}-?\d{1})?$/,
    personalIdPlaceholder: "001-1234567-8",
    taxIdLabel: "RNC",
    taxIdRegex: /^(\d{9})?$/,
    taxIdPlaceholder: "123456789",
    ivaOptions: [0, 18],
    ivaGeneral: 18,
  },
  GT: {
    code: "GT",
    name: "Guatemala",
    phoneCode: "502",
    defaultCurrency: "USD",
    defaultTimezone: "America/Guatemala",
    locale: "es-GT",
    personalIdLabel: "DPI",
    personalIdRegex: /^(\d{13})?$/,
    personalIdPlaceholder: "1234567890101",
    taxIdLabel: "NIT",
    taxIdRegex: /^[0-9-]{0,12}$/,
    taxIdPlaceholder: "1234567-8",
    ivaOptions: [0, 12],
    ivaGeneral: 12,
  },
  HN: {
    code: "HN",
    name: "Honduras",
    phoneCode: "504",
    defaultCurrency: "USD",
    defaultTimezone: "America/Tegucigalpa",
    locale: "es-HN",
    personalIdLabel: "DNI",
    personalIdRegex: /^(\d{13})?$/,
    personalIdPlaceholder: "0101199012345",
    taxIdLabel: "RTN",
    taxIdRegex: /^(\d{14})?$/,
    taxIdPlaceholder: "01011990123456",
    ivaOptions: [0, 15],
    ivaGeneral: 15,
  },
  SV: {
    code: "SV",
    name: "El Salvador",
    phoneCode: "503",
    defaultCurrency: "USD",
    defaultTimezone: "America/El_Salvador",
    locale: "es-SV",
    personalIdLabel: "DUI",
    personalIdRegex: /^(\d{8}-?\d{1})?$/,
    personalIdPlaceholder: "12345678-9",
    taxIdLabel: "NIT",
    taxIdRegex: /^(\d{4}-?\d{6}-?\d{3}-?\d{1})?$/,
    taxIdPlaceholder: "0614-123456-001-2",
    ivaOptions: [0, 13],
    ivaGeneral: 13,
  },
  NI: {
    code: "NI",
    name: "Nicaragua",
    phoneCode: "505",
    defaultCurrency: "USD",
    defaultTimezone: "America/Managua",
    locale: "es-NI",
    personalIdLabel: "Cédula",
    personalIdRegex: /^[0-9A-Z-]{0,16}$/,
    personalIdPlaceholder: "001-010190-0001A",
    taxIdLabel: "RUC",
    taxIdRegex: /^[0-9A-Z]{0,14}$/,
    taxIdPlaceholder: "J0310000012345",
    ivaOptions: [0, 15],
    ivaGeneral: 15,
  },
  CU: {
    code: "CU",
    name: "Cuba",
    phoneCode: "53",
    defaultCurrency: "USD",
    defaultTimezone: "America/Havana",
    locale: "es-CU",
    personalIdLabel: "CI",
    personalIdRegex: /^(\d{11})?$/,
    personalIdPlaceholder: "90010112345",
    taxIdLabel: "NIT",
    taxIdRegex: /^(\d{11})?$/,
    taxIdPlaceholder: "90010112345",
    ivaOptions: [0],
    ivaGeneral: 0,
  },
}

export const DEFAULT_COUNTRY: CountryCode = "AR"

export const COUNTRY_OPTIONS = Object.values(COUNTRIES)
  .sort((a, b) => a.name.localeCompare(b.name, "es"))
  .map((c) => ({ value: c.code, label: `${c.name} (+${c.phoneCode})` }))

/**
 * Tasa general de IVA del país indicado. Es el default correcto cuando una org
 * no tiene tasa propia guardada; usar un literal fijo le cobraría a un cliente
 * chileno la alícuota argentina.
 */
export function getIvaGeneral(code?: string | null): number {
  return getCountryConfig(code).ivaGeneral
}

export function getCountryConfig(code?: string | null): CountryConfig {
  if (code && code in COUNTRIES) {
    return COUNTRIES[code as CountryCode]
  }
  return COUNTRIES[DEFAULT_COUNTRY]
}

/**
 * Formatea un número de teléfono para WhatsApp según el país
 */
export function formatPhoneForCountry(phone: string, countryCode?: string | null): string {
  const country = getCountryConfig(countryCode)
  let cleaned = phone.replace(/\D/g, "")

  // Si empieza con 0, removemos el 0 y agregamos código de país
  if (cleaned.startsWith("0")) {
    cleaned = country.phoneCode + cleaned.substring(1)
  }

  // Si ya tiene el código de país, dejarlo
  if (cleaned.startsWith(country.phoneCode)) {
    return cleaned
  }

  // Si el número es local (sin código de país), agregar el código
  // Heurística: si tiene 10 dígitos o menos, probablemente es local
  if (cleaned.length <= 10) {
    cleaned = country.phoneCode + cleaned
  }

  return cleaned
}
