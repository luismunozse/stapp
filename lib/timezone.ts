export interface TimezoneOption {
  value: string
  label: string
  offset: string
}

export const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires"

// Curated list of timezones relevant for Latin America, US, and Europe
export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  // Argentina
  { value: "America/Argentina/Buenos_Aires", label: "Argentina (Buenos Aires)", offset: "UTC-3" },
  // Mexico
  { value: "America/Mexico_City", label: "Mexico (Ciudad de Mexico)", offset: "UTC-6" },
  { value: "America/Cancun", label: "Mexico (Cancun)", offset: "UTC-5" },
  { value: "America/Tijuana", label: "Mexico (Tijuana)", offset: "UTC-8" },
  { value: "America/Chihuahua", label: "Mexico (Chihuahua)", offset: "UTC-7" },
  // Chile
  { value: "America/Santiago", label: "Chile (Santiago)", offset: "UTC-4" },
  // Colombia
  { value: "America/Bogota", label: "Colombia (Bogota)", offset: "UTC-5" },
  // Peru
  { value: "America/Lima", label: "Peru (Lima)", offset: "UTC-5" },
  // Uruguay
  { value: "America/Montevideo", label: "Uruguay (Montevideo)", offset: "UTC-3" },
  // Brasil
  { value: "America/Sao_Paulo", label: "Brasil (Sao Paulo)", offset: "UTC-3" },
  { value: "America/Manaus", label: "Brasil (Manaus)", offset: "UTC-4" },
  // Bolivia
  { value: "America/La_Paz", label: "Bolivia (La Paz)", offset: "UTC-4" },
  // Paraguay
  { value: "America/Asuncion", label: "Paraguay (Asuncion)", offset: "UTC-4" },
  // Venezuela
  { value: "America/Caracas", label: "Venezuela (Caracas)", offset: "UTC-4" },
  // Ecuador
  { value: "America/Guayaquil", label: "Ecuador (Guayaquil)", offset: "UTC-5" },
  // Costa Rica
  { value: "America/Costa_Rica", label: "Costa Rica", offset: "UTC-6" },
  // Panama
  { value: "America/Panama", label: "Panama", offset: "UTC-5" },
  // Republica Dominicana
  { value: "America/Santo_Domingo", label: "Republica Dominicana", offset: "UTC-4" },
  // Guatemala
  { value: "America/Guatemala", label: "Guatemala", offset: "UTC-6" },
  // Honduras
  { value: "America/Tegucigalpa", label: "Honduras", offset: "UTC-6" },
  // El Salvador
  { value: "America/El_Salvador", label: "El Salvador", offset: "UTC-6" },
  // Nicaragua
  { value: "America/Managua", label: "Nicaragua", offset: "UTC-6" },
  // Cuba
  { value: "America/Havana", label: "Cuba (La Habana)", offset: "UTC-5" },
  // Puerto Rico
  { value: "America/Puerto_Rico", label: "Puerto Rico", offset: "UTC-4" },
  // Estados Unidos
  { value: "America/New_York", label: "EEUU (Nueva York / Este)", offset: "UTC-5" },
  { value: "America/Chicago", label: "EEUU (Chicago / Centro)", offset: "UTC-6" },
  { value: "America/Denver", label: "EEUU (Denver / Montana)", offset: "UTC-7" },
  { value: "America/Los_Angeles", label: "EEUU (Los Angeles / Pacifico)", offset: "UTC-8" },
  // Europa
  { value: "Europe/Madrid", label: "Espana (Madrid)", offset: "UTC+1" },
  { value: "Europe/London", label: "Reino Unido (Londres)", offset: "UTC+0" },
  { value: "Europe/Paris", label: "Francia (Paris)", offset: "UTC+1" },
  { value: "Europe/Berlin", label: "Alemania (Berlin)", offset: "UTC+1" },
  { value: "Europe/Rome", label: "Italia (Roma)", offset: "UTC+1" },
  { value: "Europe/Lisbon", label: "Portugal (Lisboa)", offset: "UTC+0" },
]

export function formatDateValue(
  date: Date | string | null | undefined,
  timezone: string = DEFAULT_TIMEZONE,
  locale: string = "es-AR"
): string {
  if (!date) return ""
  const d = typeof date === "string" ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ""

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: timezone,
  }).format(d)
}

export function formatDateTimeValue(
  date: Date | string | null | undefined,
  timezone: string = DEFAULT_TIMEZONE,
  locale: string = "es-AR"
): string {
  if (!date) return ""
  const d = typeof date === "string" ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ""

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(d)
}
