export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-muted" />
        <div className="space-y-2">
          <div className="h-7 w-48 rounded bg-muted" />
          <div className="h-4 w-72 rounded bg-muted" />
        </div>
      </div>
      {/* Tabs */}
      <div className="grid grid-cols-5 gap-2 max-w-3xl">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-9 rounded-md bg-muted" />
        ))}
      </div>
      {/* Grid */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="rounded-lg border overflow-hidden">
            <div className="aspect-video bg-muted" />
            <div className="p-3 space-y-2">
              <div className="h-4 w-3/4 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
