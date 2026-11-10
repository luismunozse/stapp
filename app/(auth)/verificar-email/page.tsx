"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { AuthSplitLayout } from "@/components/auth/auth-split-layout"
import { AuthHeader } from "@/components/auth/auth-header"
import { CheckCircle, XCircle, Loader2, Mail } from "lucide-react"
import { Input } from "@/components/ui/input"

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

  const ok = status === "success" || status === "already"

  return (
    <AuthSplitLayout>
      <div className="space-y-8" aria-live="polite">
        <AuthHeader
          icon={
            status === "loading" ? (
              <Loader2 className="animate-spin" />
            ) : ok ? (
              <CheckCircle />
            ) : (
              <XCircle />
            )
          }
          tone={status === "error" ? "error" : ok ? "success" : "info"}
          title={
            status === "loading"
              ? "Verificando tu cuenta…"
              : status === "success"
                ? "¡Email verificado!"
                : status === "already"
                  ? "Tu email ya estaba verificado"
                  : "No pudimos verificar tu cuenta"
          }
          description={
            status === "loading"
              ? "Esto tarda unos segundos."
              : status === "success"
                ? "Tu cuenta está lista. Ya podés iniciar sesión."
                : status === "already"
                  ? "Tu cuenta ya había sido verificada antes. Podés iniciar sesión."
                  : errorMessage
          }
        />

        {ok && (
          <Button onClick={handleGoToLogin} className="w-full h-11">
            Ir a iniciar sesión
          </Button>
        )}

        {status === "error" && (
          <>
            <div className="space-y-3 rounded-xl border bg-muted/40 p-4">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                ¿Necesitás un nuevo enlace de verificación?
              </p>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="tu@email.com"
                  aria-label="Email para reenviar la verificación"
                  autoComplete="email"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={handleResend} disabled={resendLoading} className="shrink-0">
                  {resendLoading ? "Enviando..." : "Reenviar"}
                </Button>
              </div>
              {resendSuccess && (
                <p className="text-xs text-success">
                  Email enviado. Revisá tu bandeja de entrada y la carpeta de spam.
                </p>
              )}
              {resendError && <p className="text-xs text-destructive">{resendError}</p>}
            </div>

            <Button onClick={handleGoToLogin} variant="outline" className="w-full h-11">
              Ir a iniciar sesión
            </Button>
          </>
        )}
      </div>
    </AuthSplitLayout>
  )
}

export default function VerificarEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center bg-background">
          <div className="animate-pulse text-muted-foreground">Cargando...</div>
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  )
}
