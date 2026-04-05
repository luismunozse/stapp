"use client"

import { use } from "react"
import { TicketDetailSuperadmin } from "@/components/superadmin/soporte/ticket-detail-superadmin"

interface PageProps {
  params: Promise<{ id: string }>
}

export default function SuperadminTicketDetailPage({ params }: PageProps) {
  const { id } = use(params)

  return (
    <div className="space-y-4 sm:space-y-6">
      <TicketDetailSuperadmin ticketId={id} />
    </div>
  )
}
