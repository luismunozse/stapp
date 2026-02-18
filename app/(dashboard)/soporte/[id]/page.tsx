import { TicketDetail } from "@/components/soporte/ticket-detail"

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="space-y-4 sm:space-y-6">
      <TicketDetail ticketId={id} />
    </div>
  )
}
