"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { CheckCircle, XCircle, Loader2, Mail } from "lucide-react"
import { Input } from "@/components/ui/input"
import { BusinessLogo } from "@/components/shared/business-logo"

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get("token")

  const [status, setStatus] = useState<"loading" | "success" | "already" | "error">("loading")
  const [errorMessage, setErrorMessage] = useState("")

  // Resend verification
  const [resendEmail, setResendEmail] = useState("")
  const [resendLoading, setResendLoading] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)
  const [resendError, setResendError] = useState("")

  const handleResend = async () => {
    if (!resendEmail) {
      setResendError("Ingresá tu email")
      return
    }
    setResendLoading(true)
    setResendError("")
    setResendSuccess(false)
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resendEmail }),
      })
      if (res.ok) {
        setResendSuccess(true)
      } else {
        const data = await res.json()
        setResendError(data.error || "Error al reenviar")
      }
    } catch {
      setResendError("Error de conexión")
    } finally {
      setResendLoading(false)
    }
  }

  useEffect(() => {
    if (!token) {
      setStatus("error")
      setErrorMessage("Token de verificación no proporcionado")
      return
    }

    const verifyEmail = async () => {
      try {
        const res = await fetch(`/api/auth/verify-email?token=${token}`)
        const data = await res.json()

        if (res.ok) {
          if (data.alreadyVerified) {
            setStatus("already")
          } else {
            setStatus("success")
          }
        } else {
          setStatus("error")
          setErrorMessage(data.error || "Error al verificar el email")
        }
      } catch {
        setStatus("error")
        setErrorMessage("Error de conexión. Intenta de nuevo.")
      }
    }

    verifyEmail()
  }, [token])

  const handleGoToLogin = () => {
    router.push("/login")
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 dark:bg-background px-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle variant="icon" />
      </div>

      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 pb-4">
          <div className="flex justify-center py-4">
            <BusinessLogo size="xl" showText={false} />
          </div>
          <CardTitle className="text-2xl text-center">
            Verificación de Email
          </CardTitle>
          <CardDescription className="text-center">
            {status === "loading" && "Verificando tu cuenta..."}
            {status === "success" && "Tu cuenta ha sido verificada"}
            {status === "already" && "Tu cuenta ya estaba verificada"}
            {status === "error" && "No pudimos verificar tu cuenta"}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col items-center space-y-6">
          {status === "loading" && (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-16 w-16 animate-spin text-primary" />
              <p className="text-muted-foreground">Por favor espera...</p>
            </div>
          )}

          {(status === "success" || status === "already") && (
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-4">
                <CheckCircle className="h-12 w-12 text-green-600 dark:text-green-400" />
              </div>
              <div className="text-center space-y-2">
                <p className="text-lg font-medium text-foreground">
                  {status === "success" ? "¡Email verificado!" : "Email ya verificado"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {status === "success"
                    ? "Tu cuenta está lista. Ya puedes iniciar sesión."
                    : "Tu cuenta ya había sido verificada anteriormente."}
                </p>
              </div>
              <Button onClick={handleGoToLogin} className="w-full mt-4">
                Ir a Iniciar Sesión
              </Button>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-4 w-full">
              <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-4">
                <XCircle className="h-12 w-12 text-red-600 dark:text-red-400" />
              </div>
              <div className="text-center space-y-2">
                <p className="text-lg font-medium text-foreground">
                  Error de verificación
                </p>
                <p className="text-sm text-muted-foreground">
                  {errorMessage}
                </p>
              </div>

              {/* Resend verification */}
              <div className="w-full space-y-3 mt-2 p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-center text-muted-foreground flex items-center justify-center gap-1">
                  <Mail className="h-4 w-4" />
                  ¿Necesitás un nuevo enlace de verificación?
                </p>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="tu@email.com"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleResend}
                    disabled={resendLoading}
                    size="sm"
                    className="shrink-0"
                  >
                    {resendLoading ? "Enviando..." : "Reenviar"}
                  </Button>
                </div>
                {resendSuccess && (
                  <p className="text-xs text-green-600 dark:text-green-400 text-center">
                    Email enviado. Revisá tu bandeja de entrada y la carpeta de spam.
                  </p>
                )}
                {resendError && (
                  <p className="text-xs text-destructive text-center">{resendError}</p>
                )}
              </div>

              <div className="flex flex-col gap-2 w-full mt-2">
                <Button onClick={handleGoToLogin} variant="outline" className="w-full">
                  Ir a Iniciar Sesión
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function VerificarEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-muted/30 dark:bg-background">
          <div className="animate-pulse text-muted-foreground">Cargando...</div>
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  )
}
