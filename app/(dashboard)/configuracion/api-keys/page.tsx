"use client"

import { KeyRound } from "lucide-react"
import { ApiKeysManager } from "@/components/configuracion/api-keys-manager"
import { PageShell } from "@/components/ui/page-shell"

export default function ApiKeysPage() {
  return (
    <PageShell
      title="API keys"
      description="Credenciales de acceso programático a la API de STApp."
      icon={KeyRound}
      backHref="/configuracion"
      backLabel="Volver a configuración"
    >
      <ApiKeysManager />
    </PageShell>
  )
}
