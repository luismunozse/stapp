"use client"

import Link from "next/link"
import { Building2, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AuthSplitLayout } from "@/components/auth/auth-split-layout"
import { AuthHeader } from "@/components/auth/auth-header"

export default function TenantNotFoundPage() {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  const homeUrl = `https://${rootDomain}`

  return (
    <AuthSplitLayout>
      <div className="space-y-8">
        <AuthHeader
          icon={<Building2 />}
          tone="error"
          title="Negocio no encontrado"
          description="El negocio que buscás no existe o fue desactivado. Revisá que la dirección sea correcta o consultá al administrador del negocio."
        />
        <Button asChild className="w-full h-11 gap-2">
          <a href={homeUrl} target="_blank" rel="noopener noreferrer">
            Ir a {rootDomain}
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </Button>
        <p className="text-center text-sm text-muted-foreground lg:text-left">
          ¿Querés crear tu propio negocio?{" "}
          <Link href="/registro" className="font-medium text-primary hover:underline">
            Registralo acá
          </Link>
        </p>
      </div>
    </AuthSplitLayout>
  )
}
