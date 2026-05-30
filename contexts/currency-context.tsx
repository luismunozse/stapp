"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { useSession } from "next-auth/react"
import {
  formatCurrencyValue,
  CURRENCIES,
  DEFAULT_CURRENCY,
  type CurrencyCode,
} from "@/lib/currency"
import {
  formatDateValue,
  formatDateTimeValue,
  DEFAULT_TIMEZONE,
} from "@/lib/timezone"
import { DEFAULT_COUNTRY, getCountryConfig, type CountryCode } from "@/lib/countries"

interface CurrencyContextType {
  currency: CurrencyCode
  timezone: string
  pais: CountryCode
  organizationName: string
  formatPrice: (amount: number | string | null | undefined) => string
  formatDate: (date: Date | string | null | undefined) => string
  formatDateTime: (date: Date | string | null | undefined) => string
}

const CurrencyContext = createContext<CurrencyContextType>({
  currency: DEFAULT_CURRENCY,
  timezone: DEFAULT_TIMEZONE,
  pais: DEFAULT_COUNTRY,
  organizationName: "",
  formatPrice: (amount) => formatCurrencyValue(amount, DEFAULT_CURRENCY),
  formatDate: (date) => formatDateValue(date, DEFAULT_TIMEZONE),
  formatDateTime: (date) => formatDateTimeValue(date, DEFAULT_TIMEZONE),
})

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession()
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY)
  const [timezone, setTimezone] = useState<string>(DEFAULT_TIMEZONE)
  const [pais, setPais] = useState<CountryCode>(DEFAULT_COUNTRY)
  const [organizationName, setOrganizationName] = useState<string>("")

  useEffect(() => {
    if (!session?.user?.organizationId) return
    const controller = new AbortController()

    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/configuracion", { signal: controller.signal })
        if (!res.ok) return
        const contentType = res.headers.get("content-type") || ""
        if (!contentType.includes("application/json")) return
        const data = await res.json()
        if (data.moneda && data.moneda in CURRENCIES) {
          setCurrency(data.moneda as CurrencyCode)
        }
        if (data.zonaHoraria) {
          setTimezone(data.zonaHoraria)
        }
        if (data.pais) {
          setPais(data.pais as CountryCode)
        }
        if (data.nombreEmpresa) {
          setOrganizationName(data.nombreEmpresa)
        }
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof SyntaxError) return
        console.error("Error fetching config:", error)
      }
    }

    fetchConfig()
    return () => controller.abort()
  }, [session?.user?.organizationId])

  const formatPrice = useCallback(
    (amount: number | string | null | undefined) => {
      return formatCurrencyValue(amount, currency)
    },
    [currency]
  )

  const locale = getCountryConfig(pais).locale

  const formatDate = useCallback(
    (date: Date | string | null | undefined) => {
      return formatDateValue(date, timezone, locale)
    },
    [timezone, locale]
  )

  const formatDateTime = useCallback(
    (date: Date | string | null | undefined) => {
      return formatDateTimeValue(date, timezone, locale)
    },
    [timezone, locale]
  )

  return (
    <CurrencyContext.Provider value={{ currency, timezone, pais, organizationName, formatPrice, formatDate, formatDateTime }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  return useContext(CurrencyContext)
}
