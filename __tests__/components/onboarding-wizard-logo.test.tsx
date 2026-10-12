/**
 * Onboarding wizard, business step ("Personalizá tu negocio").
 *
 * Bug (#443): with a logo picked, "Siguiente" POSTed to /api/configuracion/logo
 * (a route that never existed) and silently did nothing; without a logo it sent
 * `nombreMostrar`, a field the PUT handler ignores. Neither path showed errors.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { OnboardingWizard } from "@/components/onboarding/wizard/onboarding-wizard"
import type { OnboardingWizardProps } from "@/components/onboarding/wizard/types"
import { json, wizardProps } from "./onboarding-wizard-fixtures"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const mockCompress = vi.fn()
vi.mock("@/lib/images/compress-image", () => ({
  compressImageToDataUrl: (...args: unknown[]) => mockCompress(...args),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const DATA_URL = "data:image/png;base64,AAAA"
const PREGUNTA = /¿Tenés un equipo para cargar ahora\?/

function configPuts() {
  return mockFetch.mock.calls.filter(([url, init]) => url === "/api/configuracion" && init?.method === "PUT")
}

async function renderOnStep1(overrides: Partial<OnboardingWizardProps> = {}) {
  mockFetch.mockImplementation(async () => json({}))
  const { container } = render(<OnboardingWizard {...wizardProps(overrides)} />)
  fireEvent.click(screen.getByRole("button", { name: /Comenzar/i }))
  await screen.findByText(/Personalizá tu negocio/i)
  return container
}

function nombreInput() {
  return screen.getByLabelText(/Nombre de tu negocio/i)
}

function pickFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

describe("OnboardingWizard — paso del negocio", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    mockCompress.mockResolvedValue(DATA_URL)
    URL.createObjectURL = vi.fn(() => "blob:preview")
  })

  it("con logo elegido manda un único PUT con logoData, logoMime y nombreEmpresa, y avanza", async () => {
    const container = await renderOnStep1()
    fireEvent.change(nombreInput(), { target: { value: "  Mi Taller " } })
    pickFile(container, new File(["x"], "logo.png", { type: "image/png" }))

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    await screen.findByRole("heading", { name: PREGUNTA })
    const puts = configPuts()
    expect(puts).toHaveLength(1)
    expect(JSON.parse(puts[0][1].body as string)).toEqual({
      nombreEmpresa: "Mi Taller",
      logoData: "AAAA",
      logoMime: "image/png",
    })
    expect(mockFetch.mock.calls.some(([url]) => url === "/api/configuracion/logo")).toBe(false)
    const progressPut = mockFetch.mock.calls.find(
      ([url, init]) => url === "/api/onboarding/progress" && init?.method === "PUT"
    )
    expect(JSON.parse(progressPut![1].body as string)).toEqual({ step_logo: true })
  })

  it("sin logo manda nombreEmpresa (no nombreMostrar) y avanza", async () => {
    await renderOnStep1()
    fireEvent.change(nombreInput(), { target: { value: "Mi Taller" } })

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    await screen.findByRole("heading", { name: PREGUNTA })
    const puts = configPuts()
    expect(puts).toHaveLength(1)
    expect(JSON.parse(puts[0][1].body as string)).toEqual({ nombreEmpresa: "Mi Taller" })
    expect(mockCompress).not.toHaveBeenCalled()
  })

  it("sin nombre ni logo avanza sin llamar a la API", async () => {
    await renderOnStep1()

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    await screen.findByRole("heading", { name: PREGUNTA })
    expect(configPuts()).toHaveLength(0)
  })

  it("un logo que vino del servidor no se vuelve a subir", async () => {
    await renderOnStep1({ nombreNegocio: "Taller", logoUrl: "https://cdn.test/logo.png" })
    await screen.findByAltText("Vista previa del logo")

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    await screen.findByRole("heading", { name: PREGUNTA })
    const body = JSON.parse(configPuts()[0][1].body as string)
    expect(body).toEqual({ nombreEmpresa: "Taller" })
    expect(mockCompress).not.toHaveBeenCalled()
  })

  it("si la API responde 400 se queda en el paso y muestra el mensaje", async () => {
    const container = await renderOnStep1()
    pickFile(container, new File(["x"], "logo.png", { type: "image/png" }))
    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? json({ error: "El logo es demasiado grande" }, 400) : json({})
    )

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    expect(await screen.findByRole("alert")).toHaveTextContent("El logo es demasiado grande")
    expect(screen.getByText(/Personalizá tu negocio/i)).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: PREGUNTA })).not.toBeInTheDocument()
  })

  it("si falla la red se queda en el paso y muestra un mensaje genérico", async () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => {})
    await renderOnStep1()
    fireEvent.change(nombreInput(), { target: { value: "Mi Taller" } })
    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") throw new TypeError("network down")
      return json({})
    })

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: PREGUNTA })).not.toBeInTheDocument()
    expect(logError).toHaveBeenCalled()
  })

  it("rechaza archivos que no son imagen con un mensaje inline", async () => {
    const container = await renderOnStep1()

    pickFile(container, new File(["x"], "doc.pdf", { type: "application/pdf" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/imagen válida/i)
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))
    await waitFor(() => expect(screen.getByRole("heading", { name: PREGUNTA })).toBeInTheDocument())
    expect(configPuts()).toHaveLength(0)
  })

  it("rechaza imágenes de más de 5MB con un mensaje inline", async () => {
    const container = await renderOnStep1()
    const big = new File(["x"], "big.png", { type: "image/png" })
    Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 })

    pickFile(container, big)

    expect(await screen.findByRole("alert")).toHaveTextContent(/5MB/)
  })

  it("un archivo inválido después de uno válido descarta el logo anterior", async () => {
    const container = await renderOnStep1()
    fireEvent.change(nombreInput(), { target: { value: "Mi Taller" } })
    pickFile(container, new File(["x"], "logo.png", { type: "image/png" }))
    pickFile(container, new File(["x"], "doc.pdf", { type: "application/pdf" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/imagen válida/i)

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    await screen.findByRole("heading", { name: PREGUNTA })
    const puts = configPuts()
    expect(puts).toHaveLength(1)
    expect(JSON.parse(puts[0][1].body as string)).toEqual({ nombreEmpresa: "Mi Taller" })
    expect(mockCompress).not.toHaveBeenCalled()
  })

  it("si la imagen no se puede leer muestra un mensaje de imagen y no envía el PUT", async () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => {})
    const container = await renderOnStep1()
    mockCompress.mockRejectedValue(new Event("error"))
    pickFile(container, new File(["x"], "logo.heic", { type: "image/heic" }))

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/No pudimos leer la imagen/i)
    expect(screen.queryByRole("heading", { name: PREGUNTA })).not.toBeInTheDocument()
    expect(configPuts()).toHaveLength(0)
    expect(logError).toHaveBeenCalled()
  })

  it("volver desde la pregunta conserva el nombre y no vuelve a subir el logo", async () => {
    const container = await renderOnStep1()
    fireEvent.change(nombreInput(), { target: { value: "Mi Taller" } })
    pickFile(container, new File(["x"], "logo.png", { type: "image/png" }))
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))
    await screen.findByRole("heading", { name: PREGUNTA })

    fireEvent.click(screen.getByRole("button", { name: /Atrás/i }))
    await screen.findByText(/Personalizá tu negocio/i)
    expect(nombreInput()).toHaveValue("Mi Taller")
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }))

    await screen.findByRole("heading", { name: PREGUNTA })
    const puts = configPuts()
    expect(puts).toHaveLength(2)
    expect(JSON.parse(puts[1][1].body as string)).toEqual({ nombreEmpresa: "Mi Taller" })
    expect(mockCompress).toHaveBeenCalledTimes(1)
  })
})
