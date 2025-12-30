"use client"

import Link from "next/link"
import { Building2, Home } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function TenantNotFoundPage() {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  const homeUrl = `https://${rootDomain}`

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 dark:bg-background px-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="space-y-4 pb-2">
          <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <Building2 className="h-8 w-8 text-destructive" />
          </div>
          <CardTitle className="text-2xl">
            Organización no encontrada
          </CardTitle>
          <CardDescription className="text-base">
            La organización que buscas no existe o ha sido desactivada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Verifica que la URL sea correcta o contacta al administrador de la organización.
          </p>
          <Button asChild className="w-full">
            <a href={homeUrl}>
              <Home className="mr-2 h-4 w-4" />
              Ir a {rootDomain}
            </a>
          </Button>
          <p className="text-xs text-muted-foreground">
            ¿Quieres crear tu propia organización?{" "}
            <Link href="/registro" className="text-primary hover:underline">
              Regístrate aquí
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
