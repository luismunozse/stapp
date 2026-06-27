// __tests__/components/lead-capture-form.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { LeadCaptureForm } from "@/components/chatbot/lead-capture-form"

describe("LeadCaptureForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("muestra error si el WhatsApp es inválido y no llama al fetch", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
    const onCaptured = vi.fn()
    render(<LeadCaptureForm sessionId="s1" conversacionId="c1" onCaptured={onCaptured} />)
    fireEvent.change(screen.getByPlaceholderText(/nombre/i), { target: { value: "Juan" } })
    fireEvent.change(screen.getByPlaceholderText(/whatsapp/i), { target: { value: "123" } })
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }))
    expect(await screen.findByText(/whatsapp válido/i)).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(onCaptured).not.toHaveBeenCalled()
  })

  it("postea y llama onCaptured en éxito", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, leadId: "l1" }), { status: 200 })
    )
    const onCaptured = vi.fn()
    render(<LeadCaptureForm sessionId="s1" conversacionId="c1" onCaptured={onCaptured} />)
    fireEvent.change(screen.getByPlaceholderText(/nombre/i), { target: { value: "Juan" } })
    fireEvent.change(screen.getByPlaceholderText(/whatsapp/i), { target: { value: "11 1234-5678" } })
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }))
    await waitFor(() => expect(onCaptured).toHaveBeenCalled())
    const [, init] = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    const sent = JSON.parse((init as RequestInit).body as string)
    expect(sent).toMatchObject({ sessionId: "s1", conversacionId: "c1", nombre: "Juan", fuente: "form" })
    expect(sent.telefono).toBe("1112345678")
  })
})
