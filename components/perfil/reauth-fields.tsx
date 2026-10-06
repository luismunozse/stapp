"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ReauthInput } from "@/lib/account-deletion/types"

export interface ReauthValue {
  password: string
  email: string
  totpCode: string
}

export const EMPTY_REAUTH: ReauthValue = { password: "", email: "", totpCode: "" }

export function isReauthComplete(v: ReauthValue, hasPassword: boolean, totpEnabled: boolean): boolean {
  const credencial = hasPassword ? v.password.length > 0 : v.email.trim().length > 0
  return credencial && (!totpEnabled || v.totpCode.trim().length > 0)
}

export function toReauthPayload(v: ReauthValue, hasPassword: boolean, totpEnabled: boolean): ReauthInput {
  const payload: ReauthInput = hasPassword ? { password: v.password } : { email: v.email.trim() }
  if (totpEnabled) payload.totpCode = v.totpCode.trim()
  return payload
}

const REAUTH_FALLBACKS: Record<string, string> = {
  WRONG_CREDENTIAL: "No pudimos verificar tu identidad",
  REQUIRES_2FA: "Ingresá el código de verificación en dos pasos",
  INVALID_2FA: "El código de verificación es incorrecto",
  ACCOUNT_LOCKED: "Demasiados intentos. Probá de nuevo más tarde.",
}

/**
 * Mensaje para una respuesta de error de reautenticación (WRONG_CREDENTIAL,
 * REQUIRES_2FA, INVALID_2FA, ACCOUNT_LOCKED). Usa el texto del servidor si viene.
 * Devuelve null si el código no es de reautenticación.
 */
export function reauthErrorMessage(body: { code?: string; error?: string }): string | null {
  if (!body.code || !Object.hasOwn(REAUTH_FALLBACKS, body.code)) return null
  return body.error || REAUTH_FALLBACKS[body.code]
}

interface Props {
  hasPassword: boolean
  totpEnabled: boolean
  value: ReauthValue
  onChange: (next: ReauthValue) => void
  disabled?: boolean
  idPrefix?: string
  error?: string | null
}

export function ReauthFields({ hasPassword, totpEnabled, value, onChange, disabled, idPrefix = "reauth", error }: Props) {
  return (
    <div className="space-y-3">
      {hasPassword ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-password`}>Tu contraseña</Label>
          <Input
            id={`${idPrefix}-password`}
            type="password"
            autoComplete="current-password"
            value={value.password}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, password: e.target.value })}
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-email`}>Tipeá tu email para confirmar</Label>
          <Input
            id={`${idPrefix}-email`}
            type="email"
            autoComplete="off"
            value={value.email}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, email: e.target.value })}
          />
        </div>
      )}
      {totpEnabled && (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-totp`}>Código de verificación en dos pasos</Label>
          <Input
            id={`${idPrefix}-totp`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={value.totpCode}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, totpCode: e.target.value.replace(/\D/g, "").slice(0, 6) })}
          />
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
