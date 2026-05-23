"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export function NpsSurvey() {
  const [show, setShow] = useState(false)
  const [score, setScore] = useState<number | null>(null)
  const [comentario, setComentario] = useState("")
  const [step, setStep] = useState<"score" | "comment" | "thanks">("score")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const checkNps = async () => {
      try {
        const res = await fetch("/api/nps")
        const data = await res.json()
        if (data.show) {
          // Delay para no interferir con el loading del dashboard
          setTimeout(() => setShow(true), 3000)
        }
      } catch {
        // silenciar
      }
    }
    checkNps()
  }, [])

  const handleSubmit = async () => {
    if (score === null) return
    setSubmitting(true)
    try {
      await fetch("/api/nps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, comentario: comentario.trim() || null }),
      })
      setStep("thanks")
      setTimeout(() => setShow(false), 2000)
    } catch {
      // silenciar
    } finally {
      setSubmitting(false)
    }
  }

  const handleDismiss = async () => {
    setShow(false)
    try {
      await fetch("/api/nps", { method: "PATCH" })
    } catch {
      // silenciar
    }
  }

  if (!show) return null

  return (
    <Dialog open={show} onOpenChange={(open) => !open && handleDismiss()}>
      <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-md">
        {step === "score" && (
          <>
            <DialogHeader className="text-center sm:text-center">
              <DialogTitle className="text-lg">
                Del 0 al 10, que tan probable es que recomiendes STApp?
              </DialogTitle>
            </DialogHeader>

            <div className="py-6">
              <div className="grid grid-cols-11 gap-1">
                {Array.from({ length: 11 }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setScore(i)}
                    className={cn(
                      "aspect-square rounded-lg text-sm font-semibold transition-all",
                      "hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary",
                      score === i
                        ? i <= 6
                          ? "bg-red-500 text-white shadow-lg"
                          : i <= 8
                            ? "bg-amber-500 text-white shadow-lg"
                            : "bg-green-500 text-white shadow-lg"
                        : "bg-muted hover:bg-muted/80 text-foreground"
                    )}
                  >
                    {i}
                  </button>
                ))}
              </div>
              <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                <span>Nada probable</span>
                <span>Muy probable</span>
              </div>
            </div>

            <DialogFooter className="sm:justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={handleDismiss}>
                Ahora no
              </Button>
              <Button
                size="sm"
                onClick={() => score !== null && setStep("comment")}
                disabled={score === null}
              >
                Siguiente
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "comment" && (
          <>
            <DialogHeader className="text-center sm:text-center">
              <DialogTitle className="text-lg">
                {score !== null && score <= 6
                  ? "Que podriamos mejorar?"
                  : score !== null && score <= 8
                    ? "Que te gustaria que agreguemos?"
                    : "Que es lo que mas te gusta de STApp?"}
              </DialogTitle>
            </DialogHeader>

            <div className="py-4">
              <Textarea
                placeholder="Tu opinion nos ayuda a mejorar (opcional)..."
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                rows={3}
                autoFocus
              />
            </div>

            <DialogFooter className="sm:justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStep("score")}>
                Volver
              </Button>
              <Button size="sm" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Enviando..." : "Enviar"}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "thanks" && (
          <div className="py-8 text-center">
            <div className="text-4xl mb-4">
              {score !== null && score >= 9 ? "🎉" : score !== null && score >= 7 ? "👍" : "💪"}
            </div>
            <p className="text-lg font-semibold">Gracias por tu respuesta!</p>
            <p className="text-sm text-muted-foreground mt-1">
              Tu opinion nos ayuda a seguir mejorando STApp.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
