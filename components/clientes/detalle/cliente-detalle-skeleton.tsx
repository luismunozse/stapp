import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

// Mirrors ClienteDetalle: identity row, 3 stat cards, first section card.
export function ClienteDetalleSkeleton() {
  return (
    <div className="px-4 py-6 sm:px-6 max-w-5xl mx-auto" aria-busy="true" aria-label="Cargando cliente">
      <div className="flex items-start gap-3">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <Skeleton className="h-11 w-11 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-48 max-w-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <CardContent className="space-y-2 p-3">
              <Skeleton className="mx-auto h-3 w-12" />
              <Skeleton className="mx-auto h-6 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="space-y-6 pt-6">
        <Card>
          <CardHeader><Skeleton className="h-5 w-36" /></CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-5 w-full" />)}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
