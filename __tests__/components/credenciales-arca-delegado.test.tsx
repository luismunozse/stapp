/**
 * Tests: configuración de facturación ARCA por DELEGACIÓN.
 *
 * El taller no sube ningún certificado: hace un trámite en Administrador de
 * Relaciones a favor del CUIT de la plataforma y acá solo declara su identidad
 * fiscal. Como ese trámite vive del lado de AFIP, la pantalla tiene que dejar
 * verificarlo — si no, el taller se entera de que no quedó hecho cuando le
 * falla una factura con un cliente esperando.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import React from "react"

let mockTimezone = "America/Argentina/Buenos_Aires"
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ timezone: mockTimezone }),
}))

import { CredencialesArcaDelegado } from "@/components/configuracion/credenciales-arca-delegado"

const mockFetch = vi.fn()
global.fetch = mockFetch as any

const SIN_CONFIGURAR = {
  conectado: false,
  cuit: null,
  puntoVenta: null,
  condicionFiscal: null,
}

const CONFIGURADO = {
  conectado: true,
  cuit: "30710955057",
  puntoVenta: 3,
  condicionFiscal: "RESPONSABLE_INSCRIPTO" as const,
}

describe("CredencialesArcaDelegado", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ conectado: true }) })
  })

  it("muestra el CUIT de la plataforma al que hay que delegar", () => {
    render(
      <CredencialesArcaDelegado allowEdit cuitPlataforma="23944498389" estadoInicial={SIN_CONFIGURAR} />
    )

    expect(screen.getByText(/23944498389/)).toBeInTheDocument()
  })

  /**
   * Sin el certificado de plataforma no hay a quién delegarle nada. Es un
   * problema de configuración de STApp, no del taller: hay que decirlo así y
   * no dejar guardar una fila que no va a poder emitir.
   */
  it("avisa y bloquea si la plataforma no está configurada", () => {
    render(<CredencialesArcaDelegado allowEdit cuitPlataforma={null} estadoInicial={SIN_CONFIGURAR} />)

    expect(screen.getByText(/no está disponible/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /guardar/i })).toBeDisabled()
  })

  it("guarda en modo delegado con el CUIT normalizado", async () => {
    render(
      <CredencialesArcaDelegado allowEdit cuitPlataforma="23944498389" estadoInicial={SIN_CONFIGURAR} />
    )

    fireEvent.change(screen.getByLabelText(/CUIT del taller/i), { target: { value: "30-71095505-7" } })
    fireEvent.change(screen.getByLabelText(/punto de venta/i), { target: { value: "3" } })

    await waitFor(() => expect(screen.getByRole("button", { name: /guardar/i })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe("/api/facturacion-electronica/credenciales")
    expect(init.method).toBe("PUT")
    expect(JSON.parse(init.body)).toEqual({
      modo: "delegado",
      cuit: "30710955057",
      puntoVenta: 3,
      condicionFiscal: "MONOTRIBUTO",
    })
  })

  it("no deja probar la conexión antes de guardar", () => {
    render(
      <CredencialesArcaDelegado allowEdit cuitPlataforma="23944498389" estadoInicial={SIN_CONFIGURAR} />
    )

    expect(screen.getByRole("button", { name: /probar conexi/i })).toBeDisabled()
  })

  it("al probar muestra los puntos de venta que ARCA reconoce", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, puntosVenta: [{ numero: 3, bloqueado: false }] }),
    })
    render(
      <CredencialesArcaDelegado allowEdit cuitPlataforma="23944498389" estadoInicial={CONFIGURADO} />
    )

    fireEvent.click(screen.getByRole("button", { name: /probar conexi/i }))

    await waitFor(() => {
      expect(screen.getByText(/punto de venta 3/i)).toBeInTheDocument()
    })
    expect(mockFetch.mock.calls[0][0]).toBe("/api/facturacion-electronica/probar")
  })

  /**
   * El caso esperado del primer uso: el taller todavia no hizo el tramite.
   * Tiene que ver el motivo de AFIP, no un "error" generico.
   */
  it("al probar muestra el motivo de ARCA cuando la delegación no está hecha", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: "600: CUIT representada no autorizada" }),
    })
    render(
      <CredencialesArcaDelegado allowEdit cuitPlataforma="23944498389" estadoInicial={CONFIGURADO} />
    )

    fireEvent.click(screen.getByRole("button", { name: /probar conexi/i }))

    await waitFor(() => {
      expect(screen.getByText(/no autorizada/i)).toBeInTheDocument()
    })
  })

  /**
   * 602 del lado del servidor llega como ok:true con lista vacia: la
   * delegacion funciona pero falta dar de alta el punto de venta en ARCA. Son
   * dos problemas distintos y el mensaje tiene que distinguirlos.
   */
  describe("puntos de venta que ARCA deja usar desde un sistema", () => {
    function probar(respuesta: any) {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, ...respuesta }) })
      render(
        <CredencialesArcaDelegado allowEdit cuitPlataforma="23944498389" estadoInicial={CONFIGURADO} />
      )
      fireEvent.click(screen.getByRole("button", { name: /probar conexi/i }))
    }

    it("lista vacía + Monotributo: nombra el sistema de Monotributo", async () => {
      probar({ puntosVenta: [], puntoVentaConfigurado: 1, condicionFiscal: "MONOTRIBUTO" })

      await waitFor(() => {
        expect(screen.getByText(/no tiene puntos de venta habilitados para facturar desde un sistema/i)).toBeInTheDocument()
      })
      const texto = screen.getByText(/habilitados para facturar/i).textContent ?? ""
      expect(texto).toContain("Factura Electronica - Monotributo - Web Service")
      expect(texto).not.toContain("RECE")
    })

    it("lista vacía + Responsable Inscripto: nombra el sistema RECE", async () => {
      probar({ puntosVenta: [], puntoVentaConfigurado: 1, condicionFiscal: "RESPONSABLE_INSCRIPTO" })

      await waitFor(() => {
        expect(screen.getByText(/habilitados para facturar/i)).toBeInTheDocument()
      })
      const texto = screen.getByText(/habilitados para facturar/i).textContent ?? ""
      expect(texto).toContain("RECE para aplicativo y Web Service")
      expect(texto).not.toContain("Monotributo - Web Service")
    })

    it("lista vacía sin condición fiscal: nombra los dos sistemas", async () => {
      probar({ puntosVenta: [] })

      await waitFor(() => {
        expect(screen.getByText(/habilitados para facturar/i)).toBeInTheDocument()
      })
      const texto = screen.getByText(/habilitados para facturar/i).textContent ?? ""
      expect(texto).toContain("Factura Electronica - Monotributo - Web Service")
      expect(texto).toContain("RECE para aplicativo y Web Service")
    })

    it("el punto de venta cargado no está en la lista", async () => {
      probar({
        puntosVenta: [{ numero: 2, bloqueado: false }, { numero: 4, bloqueado: false }],
        puntoVentaConfigurado: 1,
        condicionFiscal: "MONOTRIBUTO",
      })

      await waitFor(() => {
        expect(screen.getByText(/el punto de venta 1 que cargaste no está habilitado/i)).toBeInTheDocument()
      })
      const texto = screen.getByText(/que cargaste/i).textContent ?? ""
      expect(texto).toContain("punto de venta 2, punto de venta 4")
      expect(texto).toContain("creá el 1 con el sistema")
      expect(texto).toContain("Factura Electronica - Monotributo - Web Service")
    })

    it("el punto de venta cargado está bloqueado", async () => {
      probar({
        puntosVenta: [{ numero: 3, bloqueado: true }],
        puntoVentaConfigurado: 3,
        condicionFiscal: "MONOTRIBUTO",
      })

      await waitFor(() => {
        expect(screen.getByText(/el punto de venta 3 está bloqueado en ARCA/i)).toBeInTheDocument()
      })
    })

    it("el punto de venta cargado está habilitado: mensaje de éxito", async () => {
      probar({
        puntosVenta: [{ numero: 3, bloqueado: false }],
        puntoVentaConfigurado: 3,
        condicionFiscal: "MONOTRIBUTO",
      })

      await waitFor(() => {
        expect(screen.getByText(/Conexión OK\. ARCA reconoce: punto de venta 3/)).toBeInTheDocument()
      })
    })

    it("sin puntoVentaConfigurado (servidor viejo) conserva el mensaje de éxito", async () => {
      probar({ puntosVenta: [{ numero: 2, bloqueado: false }] })

      await waitFor(() => {
        expect(screen.getByText(/Conexión OK\. ARCA reconoce: punto de venta 2/)).toBeInTheDocument()
      })
    })
  })

  it("las instrucciones avisan que STApp acepta la delegación, sin prometer 24 h", () => {
    render(
      <CredencialesArcaDelegado allowEdit cuitPlataforma="23944498389" estadoInicial={SIN_CONFIGURAR} />
    )

    expect(screen.getByText(/le avisamos a STApp para que acepte la delegación/i)).toBeInTheDocument()
    expect(screen.queryByText(/24 h/i)).not.toBeInTheDocument()
  })

  describe("cuando ARCA todavía no reconoce la delegación (permisoRenuevaAt)", () => {
    function probarConPermiso(permisoRenuevaAt: string) {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: false,
          error: "600: ValidacionDeToken: No aparecio CUIT en lista de relaciones",
          permisoRenuevaAt,
        }),
      })
      render(
        <CredencialesArcaDelegado allowEdit cuitPlataforma="23944498389" estadoInicial={CONFIGURADO} />
      )
      fireEvent.click(screen.getByRole("button", { name: /probar conexi/i }))
    }

    it("muestra la hora HH:MM en la zona horaria de la organización", async () => {
      mockTimezone = "America/Argentina/Buenos_Aires"
      probarConPermiso("2026-10-09T18:30:00.000Z") // 15:30 en Buenos Aires (UTC-3)

      await waitFor(() => {
        expect(screen.getByText(/ARCA todavía no reconoce la delegación/i)).toBeInTheDocument()
      })
      expect(screen.getByText(/a partir de las 15:30/)).toBeInTheDocument()
      expect(screen.queryByText(/ya le avisamos/i)).not.toBeInTheDocument()
      expect(screen.getByText(/falta que STApp la acepte\. ARCA vuelve/)).toBeInTheDocument()
      expect(screen.queryByText(/24 h/i)).not.toBeInTheDocument()
    })

    it("con una zona horaria inválida igual muestra la explicación con HH:MM", async () => {
      mockTimezone = "No/Existe"
      probarConPermiso("2026-10-09T18:30:00.000Z")

      await waitFor(() => {
        expect(screen.getByText(/ARCA todavía no reconoce la delegación/i)).toBeInTheDocument()
      })
      expect(screen.getByText(/a partir de las 15:30/)).toBeInTheDocument()
      expect(screen.queryByText(/Error al probar/i)).not.toBeInTheDocument()
      mockTimezone = "America/Argentina/Buenos_Aires"
    })

    it("respeta otra zona horaria", async () => {
      mockTimezone = "America/Mexico_City" // UTC-6 sin horario de verano
      probarConPermiso("2026-10-09T18:30:00.000Z")

      await waitFor(() => {
        expect(screen.getByText(/a partir de las 12:30/)).toBeInTheDocument()
      })
      mockTimezone = "America/Argentina/Buenos_Aires"
    })
  })

  it("sin permisoRenuevaAt conserva el error de ARCA pero sin la promesa de 24 h", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: "600: CUIT representada no autorizada" }),
    })
    render(
      <CredencialesArcaDelegado allowEdit cuitPlataforma="23944498389" estadoInicial={CONFIGURADO} />
    )

    fireEvent.click(screen.getByRole("button", { name: /probar conexi/i }))

    await waitFor(() => {
      expect(screen.getByText(/no autorizada/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/24 h/i)).not.toBeInTheDocument()
  })
})
