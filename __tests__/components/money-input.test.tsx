// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { useState } from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { MoneyInput } from "@/components/ui/money-input"

function Controlado({ inicial = null, onValor = () => {}, soloPositivos = false }: {
  inicial?: number | null
  onValor?: (v: number | null) => void
  soloPositivos?: boolean
}) {
  const [valor, setValor] = useState<number | null>(inicial)
  return (
    <>
      <MoneyInput
        aria-label="Monto"
        value={valor}
        onValueChange={(v) => {
          onValor(v)
          // Como el precio del carrito: solo acepta montos positivos
          if (!soloPositivos || (v !== null && v > 0)) setValor(v)
        }}
      />
      <button type="button" onClick={() => setValor(2500)}>Poner 2500</button>
      <span data-testid="valor">{String(valor)}</span>
    </>
  )
}

const input = () => screen.getByLabelText("Monto") as HTMLInputElement

describe("MoneyInput", () => {
  it("emite el monto parseado en formato argentino sin tocar lo que se escribe", () => {
    const onValor = vi.fn()
    render(<Controlado onValor={onValor} />)

    fireEvent.change(input(), { target: { value: "1.234,5" } })

    expect(input()).toHaveValue("1.234,5")
    expect(onValor).toHaveBeenLastCalledWith(1234.5)
  })

  it("al salir del campo deja el texto en formato canónico", () => {
    render(<Controlado />)
    fireEvent.change(input(), { target: { value: "1234.56" } })
    fireEvent.blur(input())
    expect(input()).toHaveValue("1.234,56")
  })

  it("limpia un monto pegado con símbolo y espacios", () => {
    const onValor = vi.fn()
    render(<Controlado onValor={onValor} />)
    fireEvent.change(input(), { target: { value: "$ 1.234,56" } })
    expect(input()).toHaveValue("1.234,56")
    expect(onValor).toHaveBeenLastCalledWith(1234.56)
  })

  it("redondea a centavos", () => {
    const onValor = vi.fn()
    render(<Controlado onValor={onValor} />)
    fireEvent.change(input(), { target: { value: "10,005" } })
    expect(onValor).toHaveBeenLastCalledWith(10.01)
  })

  it("no deja escribir el signo menos salvo que se pida", () => {
    render(<Controlado />)
    fireEvent.change(input(), { target: { value: "-5" } })
    expect(input()).toHaveValue("5")
  })

  it("marca el texto inválido y emite null", () => {
    const onValor = vi.fn()
    render(<Controlado onValor={onValor} />)
    fireEvent.change(input(), { target: { value: "1.2.3" } })
    expect(input()).toHaveAttribute("aria-invalid", "true")
    expect(onValor).toHaveBeenLastCalledWith(null)
  })

  it("muestra el valor inicial formateado y sigue los cambios externos", () => {
    render(<Controlado inicial={1500} />)
    expect(input()).toHaveValue("1.500")
    fireEvent.click(screen.getByText("Poner 2500"))
    expect(input()).toHaveValue("2.500")
  })

  it("se puede borrar para reescribir; si queda vacío, al salir vuelve el último valor aceptado", () => {
    render(<Controlado inicial={1500} soloPositivos />)

    fireEvent.change(input(), { target: { value: "" } })
    expect(input()).toHaveValue("")

    fireEvent.blur(input())
    expect(input()).toHaveValue("1.500")
    expect(screen.getByTestId("valor")).toHaveTextContent("1500")
  })
})
