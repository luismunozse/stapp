"use client"

import Link from "next/link"
import { Building2, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function TenantNotFoundPage() {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  const homeUrl = `https://${rootDomain}`

  return (
    <div className="min-h-dvh flex items-center justify-center bg-muted/30 dark:bg-background px-4">
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
          <Button asChild size="lg" className="w-full gap-2 text-base font-medium">
            <a href={homeUrl} target="_blank" rel="noopener noreferrer">
              Ir a {rootDomain}
              <ExternalLink className="h-4 w-4" />
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
