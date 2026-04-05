"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Play, Loader2, CheckCircle2, XCircle, Timer } from "lucide-react"
import { toast } from "sonner"
import { CRON_JOBS, type CronJobDefinition } from "@/lib/cron-config"

type CronStatus = "idle" | "running" | "success" | "error"

export function CronPanel() {
  const [statuses, setStatuses] = useState<Record<string, CronStatus>>({})
  const [results, setResults] = useState<Record<string, string>>({})
  const [runningAll, setRunningAll] = useState(false)
  const [confirmRunAll, setConfirmRunAll] = useState(false)

  const runCron = async (job: CronJobDefinition) => {
    setStatuses(s => ({ ...s, [job.id]: "running" }))
    setResults(r => ({ ...r, [job.id]: "" }))

    try {
      const res = await fetch("/api/superadmin/run-cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: job.path }),
      })
      const data = await res.json()

      if (res.ok && (data.success !== false)) {
        setStatuses(s => ({ ...s, [job.id]: "success" }))
        // Build result summary
        const summary = Object.entries(data)
          .filter(([k]) => !["success", "timestamp"].includes(k))
          .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
          .join(", ")
        setResults(r => ({ ...r, [job.id]: summary || "OK" }))
        toast.success(`${job.name} ejecutado`)
      } else {
        setStatuses(s => ({ ...s, [job.id]: "error" }))
        setResults(r => ({ ...r, [job.id]: data.error || "Error" }))
        toast.error(`${job.name}: ${data.error || "Error"}`)
      }
    } catch (err) {
      setStatuses(s => ({ ...s, [job.id]: "error" }))
      setResults(r => ({ ...r, [job.id]: "Error de conexión" }))
      toast.error(`${job.name}: Error de conexión`)
    }
  }

  const runAll = async () => {
    setRunningAll(true)
    for (const job of CRON_JOBS) {
      await runCron(job)
    }
    setRunningAll(false)
    toast.success("Todos los crons ejecutados")
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Timer className="h-5 w-5" />
            Tareas programadas (Crons)
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmRunAll(true)}
            disabled={runningAll}
          >
            {runningAll ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 mr-1.5" />
            )}
            Ejecutar todos
          </Button>
          <ConfirmDialog
            open={confirmRunAll}
            onOpenChange={setConfirmRunAll}
            title="Ejecutar todos los crons"
            description={`Se ejecutarán ${CRON_JOBS.length} tareas programadas secuencialmente. Esto puede tomar varios minutos.`}
            onConfirm={() => {
              setConfirmRunAll(false)
              runAll()
            }}
            confirmText="Ejecutar todos"
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {CRON_JOBS.map((job) => {
            const status = statuses[job.id] || "idle"
            const result = results[job.id]

            return (
              <div
                key={job.id}
                className="flex items-center justify-between py-2.5 px-3 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{job.name}</span>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {job.schedule}
                    </Badge>
                    {status === "success" && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                    )}
                    {status === "error" && (
                      <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{job.description}</p>
                  {result && (
                    <p className={`text-xs mt-0.5 truncate ${status === "error" ? "text-red-500" : "text-green-600"}`}>
                      {result}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 flex-shrink-0"
                  onClick={() => runCron(job)}
                  disabled={status === "running"}
                  title={`Ejecutar ${job.name}`}
                >
                  {status === "running" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
