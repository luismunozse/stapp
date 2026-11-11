import { Suspense } from "react"
import { ShieldCheck } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { GarantiasList } from "@/components/garantias/garantias-list"

// Todos los roles entran (no está en lib/rutas-por-rol): el alcance lo decide
// GET /api/garantias/unificadas. El TECNICO ve solo las de reparación de su
// alcance y sin acciones de escritura.
export default function GarantiasPage() {
  return (
    <PageShell
      title="Garantías"
      description="Las garantías de reparaciones y ventas: las que están por vencer, los reclamos abiertos y las vencidas."
      icon={ShieldCheck}
    >
      <Suspense fallback={null}>
        <GarantiasList />
      </Suspense>
    </PageShell>
  )
}
