"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { buildDeletionLoginUrl, isValidTenantSlug } from "@/lib/account-deletion/urls"

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"

export function EliminarCuentaForm() {
  const [slug, setSlug] = useState("")
  const [error, setError] = useState("")

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const clean = slug.trim().toLowerCase()
    if (!clean) return setError("Ingrese el subdominio de su taller")
    if (!isValidTenantSlug(clean)) return setError("Solo letras, números y guiones (sin espacios)")
    window.location.href = buildDeletionLoginUrl(clean, ROOT_DOMAIN)
  }

  return (
    <form onSubmit={submit} className="space-y-3 not-prose" noValidate>
      <Label htmlFor="slug-eliminar">Subdominio de su taller</Label>
      <div className="flex items-center gap-2">
        <Input
          id="slug-eliminar"
          value={slug}
          onChange={(e) => { setSlug(e.target.value); setError("") }}
          placeholder="mi-taller"
          autoCapitalize="none"
          autoCorrect="off"
          aria-invalid={!!error}
        />
        <span className="text-sm text-muted-foreground whitespace-nowrap">.{ROOT_DOMAIN}</span>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit">Ir a mi cuenta</Button>
    </form>
  )
}
