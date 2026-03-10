import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

/**
 * Skeleton for a page header (title + description)
 */
export function PageHeaderSkeleton() {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-10 w-32 rounded-md" />
    </div>
  )
}

/**
 * Skeleton for a stats cards grid
 */
export function StatsGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid gap-4 md:grid-cols-2 lg:grid-cols-${count}`}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-4 rounded" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-7 w-16 mb-1" />
            <Skeleton className="h-3 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/**
 * Skeleton for a table inside a card (filters + rows)
 */
function TableCardSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col lg:flex-row gap-4">
          <Skeleton className="h-10 w-[200px] rounded-md" />
          <Skeleton className="h-10 w-[150px] rounded-md" />
          <Skeleton className="h-10 w-[150px] rounded-md" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                {Array.from({ length: columns }).map((_, i) => (
                  <th key={i} className="px-4 py-3">
                    <Skeleton className="h-4 w-20" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }).map((_, rowIndex) => (
                <tr key={rowIndex} className="border-b">
                  {Array.from({ length: columns }).map((_, colIndex) => (
                    <td key={colIndex} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Full page skeleton combining header + optional stats + table
 */
export function TablePageSkeleton({
  showStats = false,
  statsCount = 4,
  tableRows = 5,
  tableColumns = 4,
}: {
  showStats?: boolean
  statsCount?: number
  tableRows?: number
  tableColumns?: number
}) {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      {showStats && <StatsGridSkeleton count={statsCount} />}
      <TableCardSkeleton rows={tableRows} columns={tableColumns} />
    </div>
  )
}
