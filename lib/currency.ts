export type CurrencyCode =
  | "ARS"
  | "USD"
  | "MXN"
  | "CLP"
  | "COP"
  | "PEN"
  | "UYU"
  | "BRL"
  | "BOB"
  | "PYG"
  | "EUR"

export interface CurrencyConfig {
  code: CurrencyCode
  name: string
  locale: string
  symbol: string
  decimals: number
}

export const CURRENCIES: Record<CurrencyCode, CurrencyConfig> = {
  ARS: { code: "ARS", name: "Peso Argentino", locale: "es-AR", symbol: "$", decimals: 2 },
  USD: { code: "USD", name: "Dólar Estadounidense", locale: "en-US", symbol: "US$", decimals: 2 },
  MXN: { code: "MXN", name: "Peso Mexicano", locale: "es-MX", symbol: "$", decimals: 2 },
  CLP: { code: "CLP", name: "Peso Chileno", locale: "es-CL", symbol: "$", decimals: 0 },
  COP: { code: "COP", name: "Peso Colombiano", locale: "es-CO", symbol: "$", decimals: 2 },
  PEN: { code: "PEN", name: "Sol Peruano", locale: "es-PE", symbol: "S/", decimals: 2 },
  UYU: { code: "UYU", name: "Peso Uruguayo", locale: "es-UY", symbol: "$U", decimals: 2 },
  BRL: { code: "BRL", name: "Real Brasileño", locale: "pt-BR", symbol: "R$", decimals: 2 },
  BOB: { code: "BOB", name: "Boliviano", locale: "es-BO", symbol: "Bs", decimals: 2 },
  PYG: { code: "PYG", name: "Guaraní", locale: "es-PY", symbol: "₲", decimals: 0 },
  EUR: { code: "EUR", name: "Euro", locale: "es-ES", symbol: "€", decimals: 2 },
}

export const DEFAULT_CURRENCY: CurrencyCode = "ARS"

export const CURRENCY_OPTIONS = Object.values(CURRENCIES)
  .sort((a, b) => a.name.localeCompare(b.name, "es"))
  .map((c) => ({ value: c.code, label: `${c.symbol} - ${c.name} (${c.code})` }))

export function formatCurrencyValue(
  amount: number | string | null | undefined,
  currencyCode: CurrencyCode = DEFAULT_CURRENCY
): string {
  if (amount === null || amount === undefined) return ""
  const numericAmount = typeof amount === "string" ? Number(amount) : amount
  if (Number.isNaN(numericAmount)) return ""

  const config = CURRENCIES[currencyCode] || CURRENCIES[DEFAULT_CURRENCY]

  return new Intl.NumberFormat(config.locale, {
    style: "currency",
    currency: config.code,
    minimumFractionDigits: config.decimals,
    maximumFractionDigits: config.decimals,
  }).format(numericAmount)
}

/**
 * Monto abreviado para ejes y rótulos de gráficos ("$1,5 M", "1,5 mil €").
 * Usa el locale de la moneda (igual que formatCurrencyValue) para que un eje
 * en USD o EUR no salga con signo de peso. Hasta un decimal: el monto exacto
 * va en el tooltip con formatCurrencyValue.
 */
export function formatCompactCurrencyValue(
  amount: number | string | null | undefined,
  currencyCode: CurrencyCode = DEFAULT_CURRENCY
): string {
  if (amount === null || amount === undefined) return ""
  const numericAmount = typeof amount === "string" ? Number(amount) : amount
  if (!Number.isFinite(numericAmount)) return ""

  const config = CURRENCIES[currencyCode] || CURRENCIES[DEFAULT_CURRENCY]

  return new Intl.NumberFormat(config.locale, {
    notation: "compact",
    style: "currency",
    currency: config.code,
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(numericAmount)
}
