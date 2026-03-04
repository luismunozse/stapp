"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Shield, ArrowLeft } from "lucide-react"

interface TwoFactorVerifyProps {
  userId: string
  onVerified: () => void
  onCancel: () => void
}

export function TwoFactorVerify({ userId, onVerified, onCancel }: TwoFactorVerifyProps) {
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [useBackupCode, setUseBackupCode] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [useBackupCode])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/2fa/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, code: code.trim() }),
      })

      const data = await res.json()

      if (res.ok && data.valid) {
        if (data.backupCodeUsed && data.remainingBackupCodes !== undefined) {
          // Informar que se uso un backup code
          console.log(`Backup code usado. Quedan ${data.remainingBackupCodes} codigos.`)
        }
        onVerified()
      } else {
        setError(data.error || "Codigo invalido")
      }
    } catch {
      setError("Error de conexion. Intenta de nuevo.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-1 pb-2">
        <div className="flex justify-center py-4">
          <div className="rounded-full bg-primary/10 p-3">
            <Shield className="h-8 w-8 text-primary" />
          </div>
        </div>
        <CardTitle className="text-center text-xl">
          Verificacion en dos pasos
        </CardTitle>
        <CardDescription className="text-center">
          {useBackupCode
            ? "Ingresa uno de tus codigos de respaldo"
            : "Ingresa el codigo de 6 digitos de tu app de autenticacion"
          }
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded">
              <p>{error}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="totp-code">
              {useBackupCode ? "Codigo de respaldo" : "Codigo de verificacion"}
            </Label>
            <Input
              ref={inputRef}
              id="totp-code"
              type="text"
              inputMode={useBackupCode ? "text" : "numeric"}
              pattern={useBackupCode ? undefined : "[0-9]*"}
              maxLength={useBackupCode ? 8 : 6}
              placeholder={useBackupCode ? "XXXXXXXX" : "000000"}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoComplete="one-time-code"
              className="text-center text-2xl tracking-widest font-mono"
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Verificando..." : "Verificar"}
          </Button>

          <div className="flex flex-col items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => {
                setUseBackupCode(!useBackupCode)
                setCode("")
                setError("")
              }}
              className="text-primary hover:underline"
            >
              {useBackupCode
                ? "Usar codigo de la app"
                : "Usar codigo de respaldo"
              }
            </button>

            <button
              type="button"
              onClick={onCancel}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <ArrowLeft className="h-3 w-3" />
              Volver al inicio de sesion
            </button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
