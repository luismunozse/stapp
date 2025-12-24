import { ReportesView } from "@/components/reportes/reportes-view"

export default function ReportesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Reportes</h1>
        <p className="text-muted-foreground">
          Visualiza estadísticas y reportes del negocio
        </p>
      </div>
      <ReportesView />
    </div>
  )
}

