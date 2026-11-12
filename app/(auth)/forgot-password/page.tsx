"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AuthSplitLayout } from "@/components/auth/auth-split-layout"
import { AuthHeader } from "@/components/auth/auth-header"
import { ArrowLeft, CheckCircle } from "lucide-react"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Error al enviar el correo")
        return
      }

      setSent(true)
    } catch {
      setError("Error al procesar la solicitud")
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <AuthSplitLayout>
        <div className="space-y-8">
          <AuthHeader
            icon={<CheckCircle />}
            tone="success"
            title="Revisá tu correo"
            description={
              <>
                Si existe una cuenta con el email <strong className="text-foreground">{email}</strong>,
                vas a recibir un enlace para restablecer tu contraseña. El enlace vence en 1 hora.
              </>
            }
          />
          <Button asChild variant="outline" className="w-full h-11">
            <Link href="/login">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver al login
            </Link>
          </Button>
        </div>
      </AuthSplitLayout>
    )
  }

  return (
    <AuthSplitLayout>
      <div className="space-y-8">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Volver al login
        </Link>
        <AuthHeader
          title="¿Olvidaste tu contraseña?"
          description="Ingresá tu email y te enviamos un enlace para restablecerla"
        />
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div role="alert" className="bg-destructive/10 border border-destructive/30 text-destructive-text px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full h-11" disabled={loading}>
            {loading ? "Enviando..." : "Enviar enlace"}
          </Button>
        </form>
      </div>
    </AuthSplitLayout>
  )
}
