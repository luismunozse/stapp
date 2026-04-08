"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Shield, ArrowLeft } from "lucide-react"

interface TwoFactorVerifyProps {
  /**
   * ID del usuario que está verificando 2FA. Se mantiene por compatibilidad
   * pero ya no se usa internamente — la validación corre server-side dentro
   * de authorize() durante el signIn().
   */
  userId?: string
  /**
   * Callback con el código que el usuario ingresó. El padre debe pasarlo
   * a `signIn("credentials", { ..., totpCode: code })` para que el server
   * lo valide. Si la validación falla, el padre debe llamar a
   * `setExternalError("Codigo invalido")`.
   */
  onVerified: (code: string) => Promise<void> | void
  onCancel: () => void
  /**
   * Error externo seteado por el padre cuando el server rechaza el código
   * (p.ej. recibe `INVALID_2FA_CODE` del signIn). Se muestra en el componente.
   */
  externalError?: string
}

export function TwoFactorVerify({ onVerified, onCancel, externalError }: TwoFactorVerifyProps) {
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [useBackupCode, setUseBackupCode] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [useBackupCode])

  // Si el padre nos pasa un error (p.ej. el server rechazó el código),
  // lo mostramos y limpiamos el input para que el usuario reintente.
  useEffect(() => {
    if (externalError) {
      setError(externalError)
      setCode("")
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [externalError])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      // Delegamos la verificación al padre, que llamará a signIn con el
      // código. La validación real ocurre server-side en authorize().
      await onVerified(code.trim())
    } catch {
      setError("Error de conexion. Intenta de nuevo.")
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
