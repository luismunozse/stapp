import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatCurrencyValue, type CurrencyCode } from "@/lib/currency"
import { formatDateValue, formatDateTimeValue } from "@/lib/timezone"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency?: CurrencyCode): string {
  return formatCurrencyValue(amount, currency)
}

export function formatDate(date: Date | string, timezone?: string): string {
  return formatDateValue(date, timezone)
}

export function formatDateTime(date: Date | string, timezone?: string): string {
  return formatDateTimeValue(date, timezone)
}

export function calculateIVA(subtotal: number): number {
  return subtotal * 0.21
}

export function calculateTotal(subtotal: number): number {
  return subtotal + calculateIVA(subtotal)
}

