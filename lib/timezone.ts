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

/**
 * Returns calendar and time parts for a UTC instant evaluated in `timeZone`.
 * DST-safe: uses Intl.DateTimeFormat with hour12:false.
 * weekday: 0=Sunday … 6=Saturday.
 * hour: 0–23 (handles the Intl '24' quirk by mapping it to 0).
 */
export function getZonedParts(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
    timeZone,
  })

  const parts = fmt.formatToParts(date)
  const lookup = (type: string) => parts.find((p) => p.type === type)?.value ?? ""

  const year = Number(lookup("year"))
  const month = Number(lookup("month"))
  const day = Number(lookup("day"))
  const rawHour = Number(lookup("hour"))
  // Intl may emit 24 for midnight instead of 0
  const hour = rawHour === 24 ? 0 : rawHour
  const minute = Number(lookup("minute"))

  // Derive weekday from the y/m/d we just computed — reliable and avoids locale issues.
  // Date.UTC(y, m-1, d) gives a midnight-UTC instant for that calendar date.
  // getUTCDay() on that instant gives the ISO weekday for the date (0=Sun..6=Sat).
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()

  return { year, month, day, hour, minute, weekday }
}

/**
 * Returns the UTC instant that corresponds to the given wall-clock time in
 * `timeZone`. Uses the standard offset-correction algorithm — DST-safe.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  // Step 1: treat the wall-clock components as if they were UTC (naive guess)
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  // Step 2: find out what wall-clock time that UTC instant shows in the tz
  const p = getZonedParts(new Date(guess), timeZone)
  // Step 3: rebuild the "as shown" UTC from those wall-clock parts
  const asShown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, second)
  // Step 4: the offset is asShown - guess; subtract it to correct
  const offset = asShown - guess
  return new Date(guess - offset)
}

// Matchea una fecha "date-only" (columna DATE de Postgres): YYYY-MM-DD sin hora.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Convierte el valor de fecha a un instante para formatear. Para strings
 * "date-only" (YYYY-MM-DD, típico de columnas DATE) ancla al MEDIODÍA UTC, de
 * modo que renderice el mismo día calendario en todas las tz soportadas
 * (UTC-8..UTC+1). `new Date("2026-07-20")` parsea a medianoche UTC y, en una tz
 * de offset negativo (UTC-3), se muestra el día anterior (bug off-by-one).
 * Los timestamps completos (con hora/offset) se parsean tal cual.
 */
function toDisplayInstant(date: Date | string): Date {
  if (typeof date === "string") {
    if (DATE_ONLY_RE.test(date)) return new Date(`${date}T12:00:00Z`)
    return new Date(date)
  }
  return date
}

export function formatDateValue(
  date: Date | string | null | undefined,
  timezone: string = DEFAULT_TIMEZONE,
  locale: string = "es-AR"
): string {
  if (!date) return ""
  const d = toDisplayInstant(date)
  if (Number.isNaN(d.getTime())) return ""

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: timezone,
  }).format(d)
}

/**
 * Devuelve las partes Y-M-D del calendario para un instante en una zona horaria.
 * Usa Intl para resolver el día calendario real en esa tz (DST-safe).
 */
function getCalendarParts(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(date)

  const lookup = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value)

  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
  }
}

/**
 * Suma `days` días calendario a la fecha `from` evaluada en `timeZone` y
 * devuelve el ISO del día resultante anclado al mediodía (12:00) de esa tz.
 *
 * El ancla al mediodía es DST-safe y garantiza que, al formatear con
 * formatDateValue(..., timeZone), se renderice exactamente el día calendario
 * "hoy (en la tz) + days". Evita el off-by-one de `new Date()` + setDate,
 * cuyo instante UTC puede caer en otro día calendario según la tz.
 */
export function addDaysInTimeZone(
  days: number,
  timeZone: string = DEFAULT_TIMEZONE,
  from: Date = new Date()
): string {
  const { year, month, day } = getCalendarParts(from, timeZone)
  // Sumamos los días sobre el día calendario base (Date.UTC normaliza el
  // overflow de mes/año) y anclamos al mediodía UTC. El mediodía UTC se
  // renderiza al mismo día calendario para todas las zonas soportadas
  // (UTC-8 a UTC+1), igual que el ancla ya usada para fecha_prometida.
  return new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0)).toISOString()
}

export function formatTimeValue(
  date: Date | string | null | undefined,
  timezone: string = DEFAULT_TIMEZONE,
  locale: string = "es-AR"
): string {
  if (!date) return ""
  const d = typeof date === "string" ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ""

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
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
