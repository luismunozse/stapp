import { expect } from "vitest"
import { screen, waitFor } from "@testing-library/react"

/**
 * "Confirmar venta" queda deshabilitado mientras cargan los recargos por
 * método (no se cobra sin ellos). En CI lento un click inmediato caía sobre el
 * botón todavía deshabilitado: esperar a que esté habilitado antes de clickear.
 */
export async function botonConfirmarListo(): Promise<HTMLElement> {
  const boton = await screen.findByRole("button", { name: /confirmar venta/i })
  await waitFor(() => expect(boton).toBeEnabled())
  return boton
}
