/**
 * Per-print paper size: the selector next to the print button and the hook that follows the
 * organization default until the user picks another size FOR THIS PRINT.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, renderHook, act } from "@testing-library/react"
import { OrdenPapelSelect, useOrdenPapel } from "@/components/ordenes/orden-papel-select"

let orgDefault: unknown = undefined
vi.mock("@/contexts/currency-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts/currency-context")>()
  return { ...actual, useCurrency: () => ({ ...actual.useCurrency(), ordenFormatoPapel: orgDefault }) }
})

describe("OrdenPapelSelect", () => {
  it("is a native select with the three sizes and an accessible name", () => {
    render(<OrdenPapelSelect value="A4" onChange={() => {}} orgDefault="A4" />)
    const select = screen.getByRole("combobox", { name: /Tamaño de hoja para imprimir/i }) as HTMLSelectElement
    expect(select.tagName).toBe("SELECT")
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["A4", "A5", "A6"])
    expect(select.value).toBe("A4")
  })

  it("marks the workshop's default so the user knows what 'normal' is", () => {
    render(<OrdenPapelSelect value="A4" onChange={() => {}} orgDefault="A6" />)
    const select = screen.getByRole("combobox") as HTMLSelectElement
    const labels = Array.from(select.options).map((o) => o.textContent)
    expect(labels).toEqual(["A4 (hoja entera)", "A5 (media hoja)", "A6 (un cuarto de hoja) · la del taller"])
  })

  it("reports the size picked", () => {
    const onChange = vi.fn()
    render(<OrdenPapelSelect value="A4" onChange={onChange} orgDefault="A4" />)
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "A5" } })
    expect(onChange).toHaveBeenCalledWith("A5")
  })

  it("can be disabled while a print is being prepared", () => {
    render(<OrdenPapelSelect value="A4" onChange={() => {}} orgDefault="A4" disabled />)
    expect(screen.getByRole("combobox")).toBeDisabled()
  })
})

describe("useOrdenPapel", () => {
  it("starts on the organization default and the URL ALWAYS names the size the selector shows", () => {
    orgDefault = "A6"
    const { result } = renderHook(() => useOrdenPapel())
    expect(result.current.papel).toBe("A6")
    expect(result.current.orgDefault).toBe("A6")
    expect(result.current.pdfUrl("ord-1")).toBe("/api/ordenes/ord-1/pdf?papel=A6")
  })

  it("is A4 when the organization has no default (old server, column missing), and says so in the URL", () => {
    orgDefault = undefined
    const { result } = renderHook(() => useOrdenPapel())
    expect(result.current.papel).toBe("A4")
    expect(result.current.pdfUrl("ord-1")).toBe("/api/ordenes/ord-1/pdf?papel=A4")
  })

  it("the URL and the selector can never disagree: whatever papel says is what pdfUrl sends", () => {
    for (const def of [undefined, "A4", "A5", "A6"]) {
      orgDefault = def
      const { result } = renderHook(() => useOrdenPapel())
      expect(result.current.pdfUrl("o")).toBe(`/api/ordenes/o/pdf?papel=${result.current.papel}`)
      for (const picked of ["A4", "A5", "A6"] as const) {
        act(() => result.current.setPapel(picked))
        expect(result.current.pdfUrl("o")).toBe(`/api/ordenes/o/pdf?papel=${result.current.papel}`)
        expect(result.current.papel).toBe(picked)
      }
    }
  })

  it("a size picked for this print is the one that goes in the URL, even if it equals the default", () => {
    orgDefault = "A6"
    const { result } = renderHook(() => useOrdenPapel())

    act(() => result.current.setPapel("A4"))
    expect(result.current.papel).toBe("A4")
    expect(result.current.pdfUrl("ord-1")).toBe("/api/ordenes/ord-1/pdf?papel=A4")
    act(() => result.current.setPapel("A6"))
    act(() => result.current.setPapel("A5"))
    expect(result.current.pdfUrl("ord-1")).toBe("/api/ordenes/ord-1/pdf?papel=A5")
    act(() => result.current.setPapel("A4"))

    act(() => result.current.setPapel("A6"))
    expect(result.current.pdfUrl("ord-1")).toBe("/api/ordenes/ord-1/pdf?papel=A6")
  })

  it("while nothing was picked it follows the default when it arrives late (the config loads after the screen)", () => {
    orgDefault = undefined
    const { result, rerender } = renderHook(() => useOrdenPapel())
    expect(result.current.papel).toBe("A4")

    orgDefault = "A5"
    rerender()
    expect(result.current.papel).toBe("A5")
  })
})
