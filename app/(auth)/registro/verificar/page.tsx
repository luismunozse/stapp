"use client"

import { useState, Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { BusinessLogo } from "@/components/shared/business-logo"
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

  return (
    <div className="min-h-dvh flex items-center justify-center bg-muted/30 dark:bg-background px-4 py-8">
      <div className="absolute top-4 right-4">
        <ThemeToggle variant="icon" />
      </div>

      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 pb-4">
          <div className="flex justify-center py-4">
            <BusinessLogo size="xl" showText={false} />
          </div>
          <div className="flex justify-center mb-2">
            <div className="bg-primary/10 rounded-full p-3">
              <Mail className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl text-center">
            {emailFailed ? "Tu cuenta se creó, pero…" : "¡Casi listo! Revisá tu email"}
          </CardTitle>
          <CardDescription className="text-center">
            {emailFailed ? (
              <>
                No pudimos enviar el email de verificación a{" "}
                {email ? (
                  <span className="font-medium text-foreground">{email}</span>
                ) : (
                  "tu correo"
                )}
                . Reenvialo desde acá.
              </>
            ) : (
              <>
                Te enviamos un enlace de verificación a{" "}
                {email ? (
                  <span className="font-medium text-foreground">{email}</span>
                ) : (
                  "tu correo"
                )}
              </>
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {emailFailed ? (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 px-4 py-3 rounded text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                Hubo un problema al enviar el email de verificación. Tu cuenta ya existe:
                tocá <strong>"Reenviar email de verificación"</strong> para recibir el enlace.
              </span>
            </div>
          ) : (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 px-4 py-3 rounded text-sm">
              <p className="font-medium mb-1">Próximos pasos:</p>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                <li>Abrí el email que te enviamos.</li>
                <li>Hacé clic en el botón <strong>"Verificar mi email"</strong>.</li>
                <li>Iniciá sesión en tu cuenta.</li>
              </ol>
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center">
            ¿No lo encontrás? Revisá la carpeta de <strong>spam</strong> o correo no deseado.
            El email puede tardar hasta 2 minutos en llegar.
          </p>

          {resendStatus === "success" && (
            <div className="bg-success-50 dark:bg-success-100 border border-success/30 text-success-700 dark:text-success-600 px-3 py-2 rounded text-xs flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{resendMessage}</span>
            </div>
          )}

          {resendStatus === "error" && (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2 rounded text-xs flex items-start gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{resendMessage}</span>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            className="w-full"
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

          <Button asChild className="w-full">
            <a href={loginUrl}>
              Ir al login
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>

          <div className="text-center text-sm text-muted-foreground pt-2 border-t">
            <Link href="/" className="hover:text-primary hover:underline">
              Volver al inicio
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
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
