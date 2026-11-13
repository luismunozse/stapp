import type { DanoInput } from "@/lib/ordenes/danos"

export type PinVista = DanoInput & {
  numero: number
  momento?: "recepcion" | "diagnostico"
  id?: string
  /** Solo para mostrar autor/fecha en la lista (vista interna). */
  createdByNombre?: string | null
  createdAt?: string
}
