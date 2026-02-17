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

interface CurrencyContextType {
  currency: CurrencyCode
  timezone: string
  formatPrice: (amount: number | string | null | undefined) => string
  formatDate: (date: Date | string | null | undefined) => string
  formatDateTime: (date: Date | string | null | undefined) => string
}

const CurrencyContext = createContext<CurrencyContextType>({
  currency: DEFAULT_CURRENCY,
  timezone: DEFAULT_TIMEZONE,
  formatPrice: (amount) => formatCurrencyValue(amount, DEFAULT_CURRENCY),
  formatDate: (date) => formatDateValue(date, DEFAULT_TIMEZONE),
  formatDateTime: (date) => formatDateTimeValue(date, DEFAULT_TIMEZONE),
})

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession()
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY)
  const [timezone, setTimezone] = useState<string>(DEFAULT_TIMEZONE)

  useEffect(() => {
    if (!session?.user?.organizationId) return

    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/configuracion")
        if (res.ok) {
          const data = await res.json()
          if (data.moneda && data.moneda in CURRENCIES) {
            setCurrency(data.moneda as CurrencyCode)
          }
          if (data.zonaHoraria) {
            setTimezone(data.zonaHoraria)
          }
        }
      } catch (error) {
        console.error("Error fetching config:", error)
      }
    }

    fetchConfig()
  }, [session?.user?.organizationId])

  const formatPrice = useCallback(
    (amount: number | string | null | undefined) => {
      return formatCurrencyValue(amount, currency)
    },
    [currency]
  )

  const formatDate = useCallback(
    (date: Date | string | null | undefined) => {
      return formatDateValue(date, timezone)
    },
    [timezone]
  )

  const formatDateTime = useCallback(
    (date: Date | string | null | undefined) => {
      return formatDateTimeValue(date, timezone)
    },
    [timezone]
  )

  return (
    <CurrencyContext.Provider value={{ currency, timezone, formatPrice, formatDate, formatDateTime }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  return useContext(CurrencyContext)
}
