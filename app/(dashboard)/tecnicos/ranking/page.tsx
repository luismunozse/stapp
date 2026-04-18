import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { TecnicosRanking } from "@/components/tecnicos/tecnicos-ranking"

export default async function TecnicosRankingPage() {
  const session = await auth()
  const role = session?.user?.role

  if (role !== "ADMIN") {
    redirect("/dashboard")
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Ranking de técnicos</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Comparativa operativa del equipo — ingresos, SLA, reingresos y más.
        </p>
      </div>
      <TecnicosRanking />
    </div>
  )
}
