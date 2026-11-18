// QR para sacar fotos con el celular. Sin orden (alta/recepción) las fotos
// llegan en tránsito y el diálogo las entrega una sola vez al formulario.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

vi.mock("qrcode", () => ({ default: { toDataURL: async () => "data:image/png;base64,QR" } }))

import { FotoCelularDialog } from "@/components/fotos/foto-celular-dialog"

const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response

const SESION = { sesionId: "s1", token: "tok", expiresAt: new Date(Date.now() + 600_000).toISOString() }
const estado = (extra: Record<string, unknown> = {}) => ({ fotosSubidas: 0, activa: true, foto: null, ...extra })
const FOTO = { id: "p1", mime: "image/jpeg", data: btoa("hola") }

describe("FotoCelularDialog", () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const llamadas = (metodo: string) =>
    fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET") === metodo).map(([url]) => String(url))

  it("sin orden: entrega la foto al formulario, la confirma y al cerrar revoca el enlace", async () => {
    let confirmada = false
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json(SESION, 201)
      if (init?.method === "DELETE") return json({ ok: true })
      // Como el servidor: la foto sigue en tránsito hasta que se confirma.
      if (String(url).includes("recibida=p1")) confirmada = true
      return json(confirmada ? estado({ fotosSubidas: 1 }) : estado({ fotosSubidas: 1, foto: FOTO }))
    })
    const onFotoRecibida = vi.fn()
    const { rerender } = render(<FotoCelularDialog open onOpenChange={() => {}} onFotoRecibida={onFotoRecibida} />)

    expect(await screen.findByAltText("Código QR para sacar fotos con el celular")).toBeInTheDocument()
    await waitFor(() => expect(onFotoRecibida).toHaveBeenCalledTimes(1))

    const file: File = onFotoRecibida.mock.calls[0][0]
    expect(file.type).toBe("image/jpeg")
    expect(file.name).toBe("celular-p1.jpg")
    expect(file.size).toBe(4)

    expect(llamadas("POST")).toEqual(["/api/fotos/sesion-celular"])
    await waitFor(() =>
      expect(llamadas("GET")).toContain("/api/fotos/sesion-celular?sesion=s1&recibida=p1")
    )
    expect(await screen.findByText("Llegó 1 foto")).toBeInTheDocument()

    rerender(<FotoCelularDialog open={false} onOpenChange={() => {}} onFotoRecibida={onFotoRecibida} />)
    await waitFor(() => expect(llamadas("DELETE")).toEqual(["/api/fotos/sesion-celular?sesion=s1"]))
    // Nunca se entregó dos veces.
    expect(onFotoRecibida).toHaveBeenCalledTimes(1)
  })

  it("al cerrar retira lo que quedó en camino antes de revocar", async () => {
    let cerrado = false
    const entregadas: string[] = []
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json(SESION, 201)
      if (init?.method === "DELETE") return json({ ok: true })
      const u = String(url)
      // La foto recién aparece después de cerrar el QR.
      if (cerrado && !u.includes("recibida=") && entregadas.length === 0) {
        entregadas.push("p1")
        return json(estado({ fotosSubidas: 1, foto: FOTO }))
      }
      return json(estado({ fotosSubidas: entregadas.length }))
    })
    const onFotoRecibida = vi.fn()
    const { rerender } = render(<FotoCelularDialog open onOpenChange={() => {}} onFotoRecibida={onFotoRecibida} />)
    await screen.findByAltText("Código QR para sacar fotos con el celular")
    await waitFor(() => expect(llamadas("GET").length).toBeGreaterThan(0))

    cerrado = true
    rerender(<FotoCelularDialog open={false} onOpenChange={() => {}} onFotoRecibida={onFotoRecibida} />)

    await waitFor(() => expect(llamadas("DELETE")).toHaveLength(1))
    expect(onFotoRecibida).toHaveBeenCalledTimes(1)
    // La revocación va después de confirmar la entrega.
    const orden = fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`)
    expect(orden.indexOf("GET /api/fotos/sesion-celular?sesion=s1&recibida=p1")).toBeLessThan(
      orden.indexOf("DELETE /api/fotos/sesion-celular?sesion=s1")
    )
  })

  it("con orden: usa el endpoint de la orden, manda el tipo y avisa para recargar la galería", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json(SESION, 201)
      if (init?.method === "DELETE") return json({ ok: true })
      return json({ fotosSubidas: 2, activa: true })
    })
    const onFotos = vi.fn()
    render(<FotoCelularDialog ordenId="o1" tipo="DIAGNOSTICO" open onOpenChange={() => {}} onFotos={onFotos} />)

    await waitFor(() => expect(onFotos).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!
    expect(url).toBe("/api/ordenes/o1/fotos/sesion-celular")
    expect(JSON.parse(init.body)).toEqual({ tipo: "DIAGNOSTICO" })
    expect(await screen.findByText("Llegaron 2 fotos")).toBeInTheDocument()
  })

  it("muestra el error si no se pudo generar el enlace", async () => {
    fetchMock.mockResolvedValue(json({ error: "No autorizado" }, 403))
    render(<FotoCelularDialog open onOpenChange={() => {}} />)
    expect(await screen.findByText("No autorizado")).toBeInTheDocument()
  })
})
