"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"
import { FileMinus } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Acceso al listado de notas de crédito filtrado por este cliente. Solo para
 * quien entra al listado: hoy el ADMIN (el PR7 suma al vendedor habilitado).
 */
export function ClienteNotasCreditoLink({ clienteId }: { clienteId: string }) {
  const { data: session } = useSession()
  if (session?.user?.role !== "ADMIN") return null

  return (
    <Button variant="outline" size="sm" asChild className="gap-1.5">
      <Link href={`/notas-credito?cliente=${encodeURIComponent(clienteId)}`}>
        <FileMinus className="h-4 w-4" /> Notas de crédito
      </Link>
    </Button>
  )
}
