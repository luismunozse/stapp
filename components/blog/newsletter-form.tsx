"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { CheckCircle, AlertCircle } from "lucide-react"

export function NewsletterForm() {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setStatus("loading")
    setErrorMsg("")

    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "blog" }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error al registrar")
      }

      setStatus("success")
      setEmail("")
    } catch (err) {
      setStatus("error")
      setErrorMsg(err instanceof Error ? err.message : "Error al registrar")
    }
  }

  if (status === "success") {
    return (
      <div className="flex items-center justify-center gap-2 text-green-600 dark:text-green-400 py-3">
        <CheckCircle className="w-5 h-5" />
        <span className="font-medium">¡Listo! Te suscribiste correctamente.</span>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
    >
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Tu correo electrónico"
        className="flex-1 px-4 py-3 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        aria-label="Email para newsletter"
        disabled={status === "loading"}
      />
      <Button size="lg" type="submit" disabled={status === "loading"}>
        {status === "loading" ? "Enviando..." : "Suscribirme"}
      </Button>
      {status === "error" && (
        <div className="sm:absolute sm:mt-16 flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4" />
          <span>{errorMsg}</span>
        </div>
      )}
    </form>
  )
}
