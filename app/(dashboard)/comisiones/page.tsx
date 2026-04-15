import { ComisionesView } from "@/components/comisiones/comisiones-view"

export default function ComisionesPage() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Comisiones</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Liquidación de comisiones por técnico sobre órdenes entregadas y cobradas.
        </p>
      </div>
      <ComisionesView />
    </div>
  )
}
