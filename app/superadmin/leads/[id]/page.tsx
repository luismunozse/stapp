"use client"

import { use } from "react"
import { LeadDetailContent } from "./_components/lead-detail-content"

interface PageProps {
  params: Promise<{ id: string }>
}

export default function SuperadminLeadDetailPage({ params }: PageProps) {
  const { id } = use(params)

  return <LeadDetailContent leadId={id} />
}
