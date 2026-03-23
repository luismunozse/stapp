"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { History, Mail, AlertCircle, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react"

interface EmailRecord {
  id: string
  destinatario_email: string
  destinatario_nombre: string | null
  destinatario_tipo: string | null
  asunto: string
  contenido: string
  estado: "ENVIADO" | "ERROR"
  error_message: string | null
  created_at: string
}

const PAGE_SIZE = 10

export function EmailHistory() {
  const [emails, setEmails] = useState<EmailRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    fetchEmails()
  }, [page])

  const fetchEmails = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/emails/history?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`)
      if (res.ok) {
        const data = await res.json()
        setEmails(data.emails)
        setTotal(data.total)
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }

  const tipoLabel: Record<string, string> = {
    CLIENTE: "Cliente",
    TECNICO: "Técnico",
    VENDEDOR: "Vendedor",
    OTRO: "Otro",
  }

  const tipoBadgeColor: Record<string, string> = {
    CLIENTE: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    TECNICO: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    VENDEDOR: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    OTRO: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400",
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Historial de emails enviados
          {total > 0 && (
            <span className="text-sm font-normal text-muted-foreground">({total})</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded-md" />
            ))}
          </div>
        ) : emails.length === 0 ? (
          <div className="text-center py-12">
            <Mail className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">No hay emails enviados todavía</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {emails.map((email) => (
                <div
                  key={email.id}
                  className="border rounded-md hover:bg-accent/50 transition-colors"
                >
                  <button
                    className="w-full text-left p-3 flex items-center gap-3"
                    onClick={() => setExpanded(expanded === email.id ? null : email.id)}
                  >
                    {email.estado === "ENVIADO" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {email.destinatario_nombre || email.destinatario_email}
                        </span>
                        {email.destinatario_tipo && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${tipoBadgeColor[email.destinatario_tipo] || tipoBadgeColor.OTRO}`}>
                            {tipoLabel[email.destinatario_tipo] || email.destinatario_tipo}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{email.asunto}</p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatDate(email.created_at)}
                    </span>
                  </button>

                  {expanded === email.id && (
                    <div className="px-3 pb-3 border-t">
                      <div className="pt-3 space-y-2">
                        <div className="flex gap-2 text-sm">
                          <span className="text-muted-foreground">Para:</span>
                          <span>{email.destinatario_email}</span>
                        </div>
                        <div className="flex gap-2 text-sm">
                          <span className="text-muted-foreground">Asunto:</span>
                          <span className="font-medium">{email.asunto}</span>
                        </div>
                        <div className="mt-2 p-3 bg-muted/50 rounded-md text-sm whitespace-pre-wrap">
                          {email.contenido}
                        </div>
                        {email.estado === "ERROR" && email.error_message && (
                          <div className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
                            Error: {email.error_message}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Paginación */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <p className="text-sm text-muted-foreground">
                  Página {page + 1} de {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page - 1)}
                    disabled={page === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={page >= totalPages - 1}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
