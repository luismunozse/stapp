"use client"

import { useState, Suspense } from "react"
import { signIn } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { Eye, EyeOff, AlertTriangle } from "lucide-react"
import { STAppLogo } from "@/components/shared/stapp-logo"

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const callbackUrl = searchParams.get("callbackUrl") || "/superadmin/dashboard"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const result = await signIn("credentials", {
        email,
        password,
        rememberMe: "false", // Sesiones cortas para superadmin
        redirect: false,
      })

      if (result?.error) {
        if (result.error.includes("EMAIL_NOT_VERIFIED")) {
          setError("Tu email no ha sido verificado.")
        } else {
          setError("Credenciales incorrectas")
        }
        setLoading(false)
        return
      }

      // El middleware se encargará de verificar SUPERADMIN_EMAILS
      // Si llegamos hasta aquí, redirigimos al dashboard
      window.location.href = callbackUrl
    } catch (error) {
      console.error("Login error:", error)
      setError("Error al iniciar sesión")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 dark:bg-background px-4">
      {/* Theme toggle in corner */}
      <div className="absolute top-4 right-4">
        <ThemeToggle variant="icon" />
      </div>

      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 pb-2">
          <div className="flex justify-center py-4">
            <STAppLogo size="lg" showText={false} />
          </div>
          <CardTitle className="text-center text-2xl">
            <span className="text-primary">STApp</span>{" "}
            <span className="text-muted-foreground font-normal text-lg">Superadmin</span>
          </CardTitle>
          <CardDescription className="text-center">
            Panel de administración del sistema
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Este panel es solo para administradores autorizados del sistema.
              El acceso no autorizado será registrado.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded">
                <p>{error}</p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@stapp.com.ar"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading}
            >
              {loading ? "Verificando..." : "Acceder al Panel"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default function SuperadminLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-muted/30 dark:bg-background">
          <div className="animate-pulse text-muted-foreground">Cargando...</div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
