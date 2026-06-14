"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Shield, ShieldCheck, ShieldOff, Copy, Check, RefreshCw, AlertTriangle } from "lucide-react"
import Image from "next/image"
import { StatusBanner } from "@/components/ui/status-banner"

interface SecuritySettingsProps {
  totpEnabled: boolean
}

type Step = "idle" | "setup" | "verify" | "backup" | "disable"

export function SecuritySettings({ totpEnabled: initialEnabled }: SecuritySettingsProps) {
  const [totpEnabled, setTotpEnabled] = useState(initialEnabled)
  const [step, setStep] = useState<Step>("idle")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  // Setup state
  const [qrCode, setQrCode] = useState("")
  const [manualSecret, setManualSecret] = useState("")
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [verifyCode, setVerifyCode] = useState("")
  const [disableCode, setDisableCode] = useState("")
  const [copied, setCopied] = useState(false)

  const handleSetup = async () => {
    setLoading(true)
    setError("")

    try {
      const res = await fetch("/api/auth/2fa/setup", { method: "POST" })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Error al configurar 2FA")
        return
      }

      setQrCode(data.qrCode)
      setManualSecret(data.secret)
      setBackupCodes(data.backupCodes)
      setStep("setup")
    } catch {
      setError("Error de conexion")
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    setLoading(true)
    setError("")

    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: verifyCode }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Codigo incorrecto")
        return
      }

      setStep("backup")
    } catch {
      setError("Error de conexion")
    } finally {
      setLoading(false)
    }
  }

  const handleBackupDone = () => {
    setTotpEnabled(true)
    setStep("idle")
    setSuccess("2FA activado correctamente")
    setQrCode("")
    setManualSecret("")
    setVerifyCode("")
    setTimeout(() => setSuccess(""), 5000)
  }

  const handleDisable = async () => {
    setLoading(true)
    setError("")

    try {
      const res = await fetch("/api/auth/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: disableCode }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Codigo incorrecto")
        return
      }

      setTotpEnabled(false)
      setStep("idle")
      setDisableCode("")
      setSuccess("2FA desactivado")
      setTimeout(() => setSuccess(""), 5000)
    } catch {
      setError("Error de conexion")
    } finally {
      setLoading(false)
    }
  }

  const copyBackupCodes = () => {
    navigator.clipboard.writeText(backupCodes.join("\n"))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Autenticacion en dos pasos (2FA)
        </CardTitle>
        <CardDescription>
          Agrega una capa extra de seguridad a tu cuenta usando una app de autenticacion
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-success-50 dark:bg-success/15 border border-success-200 dark:border-success/30 text-success-600 dark:text-success-500 px-4 py-3 rounded text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            {success}
          </div>
        )}

        {/* Estado idle */}
        {step === "idle" && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {totpEnabled ? (
                <ShieldCheck className="h-8 w-8 text-success-600" />
              ) : (
                <ShieldOff className="h-8 w-8 text-muted-foreground" />
              )}
              <div>
                <p className="font-medium">
                  {totpEnabled ? "2FA activado" : "2FA desactivado"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {totpEnabled
                    ? "Tu cuenta esta protegida con verificacion en dos pasos"
                    : "Activa 2FA para proteger tu cuenta"
                  }
                </p>
              </div>
            </div>
            {totpEnabled ? (
              <Button
                variant="outline"
                onClick={() => { setStep("disable"); setError("") }}
              >
                Desactivar
              </Button>
            ) : (
              <Button onClick={handleSetup} disabled={loading}>
                {loading ? "Configurando..." : "Activar 2FA"}
              </Button>
            )}
          </div>
        )}

        {/* Paso 1: Escanear QR */}
        {step === "setup" && (
          <div className="space-y-4">
            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                Escanea este codigo QR con tu app de autenticacion (Google Authenticator, Authy, etc.)
              </p>
              {qrCode && (
                <div className="flex justify-center">
                  <Image
                    src={qrCode}
                    alt="QR Code para 2FA"
                    width={200}
                    height={200}
                    className="rounded border"
                    unoptimized
                  />
                </div>
              )}
              <details className="text-left">
                <summary className="text-sm text-primary cursor-pointer">
                  Ingresar codigo manualmente
                </summary>
                <code className="block mt-2 p-2 bg-muted rounded text-xs break-all font-mono">
                  {manualSecret}
                </code>
              </details>
            </div>

            <div className="space-y-2">
              <Label htmlFor="verify-code">Ingresa el codigo de 6 digitos</Label>
              <Input
                id="verify-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                className="text-center text-xl tracking-widest font-mono"
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => { setStep("idle"); setError("") }}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleVerify}
                disabled={loading || verifyCode.length !== 6}
                className="flex-1"
              >
                {loading ? "Verificando..." : "Verificar"}
              </Button>
            </div>
          </div>
        )}

        {/* Paso 2: Backup codes */}
        {step === "backup" && (
          <div className="space-y-4">
            <StatusBanner tone="warning" icon={AlertTriangle}>
              <span className="font-medium">Guarda estos codigos de respaldo.</span>{" "}
              Usa estos codigos si pierdes acceso a tu app de autenticacion. Cada codigo solo se puede usar una vez.
            </StatusBanner>

            <div className="bg-muted rounded p-4 font-mono text-sm grid grid-cols-2 gap-2">
              {backupCodes.map((code, i) => (
                <div key={i} className="text-center py-1">{code}</div>
              ))}
            </div>

            <Button
              variant="outline"
              onClick={copyBackupCodes}
              className="w-full"
            >
              {copied ? (
                <><Check className="h-4 w-4 mr-2" /> Copiados</>
              ) : (
                <><Copy className="h-4 w-4 mr-2" /> Copiar codigos</>
              )}
            </Button>

            <Button onClick={handleBackupDone} className="w-full">
              Ya guarde mis codigos
            </Button>
          </div>
        )}

        {/* Desactivar 2FA */}
        {step === "disable" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Ingresa un codigo de tu app de autenticacion para confirmar la desactivacion
            </p>

            <div className="space-y-2">
              <Label htmlFor="disable-code">Codigo de verificacion</Label>
              <Input
                id="disable-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                className="text-center text-xl tracking-widest font-mono"
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => { setStep("idle"); setError("") }}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={handleDisable}
                disabled={loading || disableCode.length !== 6}
                className="flex-1"
              >
                {loading ? "Desactivando..." : "Desactivar 2FA"}
              </Button>
            </div>
          </div>
        )}

        {/* Regenerar backup codes (solo si 2FA activo y en idle) */}
        {totpEnabled && step === "idle" && (
          <div className="pt-2 border-t">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                // Placeholder - el usuario necesita ingresar un codigo TOTP
                setStep("setup")
                handleSetup()
              }}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Regenerar codigos de respaldo
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
