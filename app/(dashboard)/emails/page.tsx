"use client"

import { useState } from "react"
import { EmailCompose } from "@/components/emails/email-compose"
import { EmailHistory } from "@/components/emails/email-history"
import { Button } from "@/components/ui/button"
import { Mail, History } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"

export default function EmailsPage() {
  const [view, setView] = useState<"compose" | "history">("compose")

  return (
    <PageShell
      title="Emails"
      description="Envía emails individuales a clientes, técnicos o vendedores"
      actions={
        <>
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
        </>
      }
    >
      {view === "compose" ? <EmailCompose /> : <EmailHistory />}
    </PageShell>
  )
}
