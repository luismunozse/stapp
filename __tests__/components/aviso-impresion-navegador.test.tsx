import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AvisoImpresionNavegador } from "@/components/aviso-impresion-navegador"
import { readAlinearArriba } from "@/lib/thermal-paper"

describe("AvisoImpresionNavegador — Alinear arriba", () => {
  beforeEach(() => localStorage.clear())

  it("arranca apagado y guarda la preferencia al activarlo", () => {
    render(<AvisoImpresionNavegador />)
    const opcion = screen.getByRole("switch", { name: /alinear arriba/i })
    expect(opcion).toHaveAttribute("aria-checked", "false")

    fireEvent.click(opcion)
    expect(opcion).toHaveAttribute("aria-checked", "true")
    expect(readAlinearArriba()).toBe(true)
  })

  it("muestra la preferencia ya guardada en el dispositivo", () => {
    localStorage.setItem("stapp:comprobante-alinear-arriba", "1")
    render(<AvisoImpresionNavegador />)
    expect(screen.getByRole("switch", { name: /alinear arriba/i })).toHaveAttribute("aria-checked", "true")
  })
})
