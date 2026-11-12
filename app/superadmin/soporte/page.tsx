"use client"

import { TicketsListSuperadmin } from "@/components/superadmin/soporte/tickets-list-superadmin"
import { PageShell } from "@/components/ui/page-shell"

export default function SuperadminSoportePage() {
  return (
    <PageShell
      title="Soporte"
      description="Gestiona los tickets de soporte de todas las organizaciones"
    >
      <TicketsListSuperadmin />
    </PageShell>
  )
}
