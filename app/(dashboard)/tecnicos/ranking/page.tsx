import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { TecnicosRanking } from "@/components/tecnicos/tecnicos-ranking"
import { PageShell } from "@/components/ui/page-shell"

export default async function TecnicosRankingPage() {
  const session = await auth()
  const role = session?.user?.role

  if (role !== "ADMIN") {
    redirect("/dashboard")
  }

  return (
    <PageShell title="Ranking de técnicos" description="Comparativa operativa del equipo — ingresos, SLA, reingresos y más.">
      <TecnicosRanking />
    </PageShell>
  )
}
