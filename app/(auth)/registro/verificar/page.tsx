"use client"

import { useState, Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { AuthSplitLayout } from "@/components/auth/auth-split-layout"
import { AuthHeader } from "@/components/auth/auth-header"
import { Mail, Loader2, CheckCircle2, AlertCircle, ArrowRight } from "lucide-react"

function VerificarContent() {
  const searchParams = useSearchParams()
  const email = searchParams.get("email") || ""
  const slug = searchParams.get("slug") || ""
  // El registro nos avisa cuando el mail de verificación NO llegó a enviarse
  // (fallo del proveedor). En ese caso mostramos un estado de error accionable
  // en vez del optimista "revisá tu bandeja".
  const emailFailed = searchParams.get("emailError") === "1"

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  const loginUrl = slug ? `https://${slug}.${rootDomain}/login` : "/login"

  const [resendLoading, setResendLoading] = useState(false)
  const [resendStatus, setResendStatus] = useState<"idle" | "success" | "error">("idle")
  const [resendMessage, setResendMessage] = useState("")

  const handleResend = async () => {
    if (!email) {
      setResendStatus("error")
      setResendMessage("Falta el email para reenviar la verificación")
      return
    }

    setResendLoading(true)
    setResendStatus("idle")

    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()

      if (!res.ok) {
        setResendStatus("error")
        setResendMessage(data.error || "Error al reenviar")
      } else {
        setResendStatus("success")
        setResendMessage(data.message || "Email reenviado. Revisá tu bandeja.")
      }
    } catch {
      setResendStatus("error")
      setResendMessage("Error de conexión. Intentá de nuevo.")
    } finally {
      setResendLoading(false)
    }
  }

  const emailDestacado = email ? (
    <span className="font-medium text-foreground">{email}</span>
  ) : (
    "tu correo"
  )

  return (
    <AuthSplitLayout>
      <div className="space-y-6">
        <AuthHeader
          icon={emailFailed ? <AlertCircle /> : <Mail />}
          tone={emailFailed ? "error" : "info"}
          title={emailFailed ? "Tu cuenta se creó, pero…" : "¡Casi listo! Revisá tu email"}
          description={
            emailFailed ? (
              <>No pudimos enviar el email de verificación a {emailDestacado}. Reenvialo desde acá.</>
            ) : (
              <>Te enviamos un enlace de verificación a {emailDestacado}.</>
            )
          }
        />

        {emailFailed ? (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Hubo un problema al enviar el email de verificación. Tu cuenta ya existe:
              tocá <strong>&quot;Reenviar email de verificación&quot;</strong> para recibir el enlace.
            </span>
          </div>
        ) : (
          <ol className="space-y-3">
            {[
              "Abrí el email que te enviamos.",
              <>Hacé clic en <strong className="text-foreground">&quot;Verificar mi email&quot;</strong>.</>,
              "Iniciá sesión en tu cuenta.",
            ].map((paso, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <span className="pt-0.5">{paso}</span>
              </li>
            ))}
          </ol>
        )}

        <p className="text-xs text-muted-foreground">
          ¿No lo encontrás? Revisá la carpeta de <strong>spam</strong> o correo no deseado.
          El email puede tardar hasta 2 minutos en llegar.
        </p>

        {resendStatus === "success" && (
          <div role="status" className="bg-success-50 dark:bg-success-100 border border-success/30 text-success-700 dark:text-success-600 px-3 py-2 rounded-lg text-xs flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>{resendMessage}</span>
          </div>
        )}

        {resendStatus === "error" && (
          <div role="alert" className="bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2 rounded-lg text-xs flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>{resendMessage}</span>
          </div>
        )}

        <div className="space-y-3">
          <Button asChild className="w-full h-11">
            <a href={loginUrl}>
              Ir al login
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full h-11"
            onClick={handleResend}
            disabled={resendLoading || !email}
          >
            {resendLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Reenviando...
              </>
            ) : (
              <>
                <Mail className="mr-2 h-4 w-4" />
                Reenviar email de verificación
              </>
            )}
          </Button>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/" className="hover:text-primary hover:underline">
            Volver al inicio
          </Link>
        </p>
      </div>
    </AuthSplitLayout>
  )
}

export default function VerificarPage() {
  return (
    <Suspense fallback={
      <div className="min-h-dvh flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <VerificarContent />
    </Suspense>
  )
}
