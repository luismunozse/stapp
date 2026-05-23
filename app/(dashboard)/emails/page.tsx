"use client"

import { useState } from "react"
import { EmailCompose } from "@/components/emails/email-compose"
import { EmailHistory } from "@/components/emails/email-history"
import { Button } from "@/components/ui/button"
import { Mail, History } from "lucide-react"

export default function EmailsPage() {
  const [view, setView] = useState<"compose" | "history">("compose")

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Emails</h1>
          <p className="text-sm text-muted-foreground">
            Envía emails individuales a clientes, técnicos o vendedores
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={view === "compose" ? "default" : "outline"}
            onClick={() => setView("compose")}
            className="gap-1.5"
          >
            <Mail className="h-4 w-4" />
            Redactar
          </Button>
          <Button
            variant={view === "history" ? "default" : "outline"}
            onClick={() => setView("history")}
            className="gap-1.5"
          >
            <History className="h-4 w-4" />
            Historial
          </Button>
        </div>
      </div>

      {view === "compose" ? <EmailCompose /> : <EmailHistory />}
    </div>
  )
}
