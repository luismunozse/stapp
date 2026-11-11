// @vitest-environment node
/**
 * Fase 2 de garantías (migración 401):
 * - Un re-ingreso cuenta contra el técnico de la orden ORIGINAL, no contra el
 *   que atiende el re-ingreso (decisión del dueño), en el resumen y en insights.
 * - Hay un solo camino que crea órdenes de re-ingreso.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { mockAuthSuccess, parseResponse } from "./helpers"
import { instalarBaseReactiva } from "../helpers/supabase-reactiva"
import { reingresosPorTecnicoOriginal } from "@/lib/tecnicos/reingresos"
import { GET as summary } from "@/app/api/tecnicos/summary/route"

const ORG = "org-1"
const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString()

const orden = (id: string, extra: Record<string, unknown>) => ({
  id,
  organization_id: ORG,
  es_practica: false,
  es_reingreso: false,
  orden_origen_id: null,
  tecnico_id: null,
  estado: "ENTREGADO",
  fecha_ingreso: hace(5),
  fecha_completado: hace(4),
  fecha_prometida: null,
  costo_final: 0,
  ...extra,
})

function taller() {
  return instalarBaseReactiva({
    ordenes_servicio: [
      // Reparaciones originales (pueden ser viejas: lo que cuenta es la fecha del re-ingreso).
      orden("orig-ana", { tecnico_id: "ana", fecha_ingreso: hace(200), fecha_completado: hace(190) }),
      orden("orig-ana-2", { tecnico_id: "ana" }),
      orden("orig-beto", { tecnico_id: "beto" }),
      // Re-ingresos: los atiende carla, pero cuentan contra ana y beto.
      orden("re-1", { es_reingreso: true, orden_origen_id: "orig-ana", tecnico_id: "carla", estado: "EN_REPARACION" }),
      orden("re-2", { es_reingreso: true, orden_origen_id: "orig-ana-2", tecnico_id: "carla" }),
      orden("re-3", { es_reingreso: true, orden_origen_id: "orig-beto", tecnico_id: null }),
      // No cuentan: fuera del período, de práctica, de venta (sin orden original) y de otra org.
      orden("re-viejo", { es_reingreso: true, orden_origen_id: "orig-beto", fecha_ingreso: hace(90) }),
      orden("re-practica", { es_reingreso: true, orden_origen_id: "orig-beto", es_practica: true }),
      orden("re-venta", { es_reingreso: true, orden_origen_id: null, tecnico_id: "carla" }),
      { ...orden("re-otra-org", { es_reingreso: true, orden_origen_id: "orig-ana" }), organization_id: "org-2" },
    ],
  })
}

describe("re-ingresos por técnico original", () => {
  it("atribuye cada re-ingreso del período al técnico de la orden original", async () => {
    taller()
    const conteo = await reingresosPorTecnicoOriginal({ organizationId: ORG, desdeISO: hace(30) })
    expect(Object.fromEntries(conteo)).toEqual({ ana: 2, beto: 1 })
  })

  it("filtra por técnico (insights)", async () => {
    taller()
    const conteo = await reingresosPorTecnicoOriginal({ organizationId: ORG, desdeISO: hace(30), tecnicoId: "beto" })
    expect(Object.fromEntries(conteo)).toEqual({ beto: 1 })
  })

  it("el resumen de técnicos los cuenta contra el original, no contra quien atiende", async () => {
    taller()
    mockAuthSuccess({ organizationId: ORG, role: "ADMIN" })
    const { status, body: data } = await parseResponse(await summary(new Request("http://localhost/api/tecnicos/summary?dias=30")))
    expect(status).toBe(200)
    const por = Object.fromEntries((data.tecnicos as any[]).map((t) => [t.tecnicoId, t.reingresos]))
    expect(por.ana).toBe(2)
    expect(por.beto).toBe(1)
    expect(por.carla ?? 0).toBe(0)
  })
})

describe("camino único al re-ingreso", () => {
  const raiz = process.cwd()
  const fuentes = (dir: string): string[] =>
    readdirSync(join(raiz, dir)).flatMap((n) => {
      const p = join(dir, n)
      if (statSync(join(raiz, p)).isDirectory()) return fuentes(p)
      return /\.(ts|tsx)$/.test(n) ? [p] : []
    })

  it("solo lib/garantias/reingreso.ts crea órdenes con es_reingreso: true", () => {
    const crean = [...fuentes("app"), ...fuentes("lib"), ...fuentes("components")].filter((f) =>
      /es_reingreso:\s*true/.test(readFileSync(join(raiz, f), "utf8"))
    )
    expect(crean).toEqual(["lib/garantias/reingreso.ts"])
  })

  it("aceptar un reclamo y el atajo del menú pasan por aceptarReclamo", () => {
    const reclamos = readFileSync(join(raiz, "lib/garantias/reclamos.ts"), "utf8")
    expect(reclamos.match(/crearOrdenReingreso\(/g)).toHaveLength(1)
    const decidir = reclamos.slice(reclamos.indexOf("export async function decidirReclamo"))
    expect(decidir.slice(0, decidir.indexOf("\nexport ", 1))).toContain("aceptarReclamo(")
    const menu = reclamos.slice(reclamos.indexOf("export async function reingresoDesdeOrden"))
    expect(menu.slice(0, menu.indexOf("\nexport ", 1))).toContain("aceptarReclamo(")

    expect(readFileSync(join(raiz, "app/api/ordenes/[id]/reingreso/route.ts"), "utf8")).toContain("reingresoDesdeOrden(")
    expect(readFileSync(join(raiz, "app/api/garantias/reclamos/[id]/route.ts"), "utf8")).toContain("decidirReclamo(")
  })
})
