"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft, KeyRound } from "lucide-react"
import { ApiKeysManager } from "@/components/configuracion/api-keys-manager"

export default function ApiKeysPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Link href="/configuracion">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <KeyRound className="h-6 w-6" /> API Keys
            </h1>
            <p className="text-sm text-muted-foreground">
              Credenciales de acceso programático a la API de STApp.
            </p>
          </div>
        </div>
      </div>

      <ApiKeysManager />
    </div>
  )
}
