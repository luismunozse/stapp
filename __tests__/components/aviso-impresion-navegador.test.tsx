import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AvisoImpresionNavegador } from "@/components/aviso-impresion-navegador"
import { readAlinearArriba } from "@/lib/thermal-paper"

describe("AvisoImpresionNavegador — Alinear arriba", () => {
  beforeEach(() => localStorage.clear())

  it("arranca activado y guarda la preferencia al desactivarlo", () => {
    render(<AvisoImpresionNavegador />)
    const opcion = screen.getByRole("switch", { name: /alinear arriba/i })
    expect(opcion).toHaveAttribute("aria-checked", "true")

    fireEvent.click(opcion)
    expect(opcion).toHaveAttribute("aria-checked", "false")
    expect(readAlinearArriba()).toBe(false)
  })

  it("muestra la preferencia ya guardada en el dispositivo", () => {
    localStorage.setItem("stapp:comprobante-alinear-arriba", "0")
    render(<AvisoImpresionNavegador />)
    expect(screen.getByRole("switch", { name: /alinear arriba/i })).toHaveAttribute("aria-checked", "false")
  })
})
