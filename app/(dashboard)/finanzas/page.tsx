import { Suspense } from "react"
import { FinanzasView } from "@/components/finanzas/finanzas-view"

export default function FinanzasPage() {
  return (
    <div className="container py-6">
      <Suspense fallback={null}>
        <FinanzasView />
      </Suspense>
    </div>
  )
}
