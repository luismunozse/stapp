import { describe, it, expect, beforeEach } from "vitest"
import { seedOrganizationFromRubro } from "@/lib/rubros/seed"
import { getRubro } from "@/lib/rubros"

/**
 * Fake mínimo de supabase-js: registra lo que se le pidió a cada tabla y
 * devuelve lo que el test le configure. Suficiente para verificar QUÉ se
 * siembra sin levantar una base.
 */
type Row = Record<string, any>

interface TablaFake {
  inserted: Row[]
  upserted: Row[]
  updated: Row[]
  rows: Row[]
  error?: { message: string } | null
}

function crearClienteFake(config: Partial<Record<string, Partial<TablaFake>>> = {}) {
  const tablas: Record<string, TablaFake> = {}

  const tabla = (nombre: string): TablaFake => {
    if (!tablas[nombre]) {
      tablas[nombre] = {
        inserted: [],
        upserted: [],
        updated: [],
        rows: [],
        error: null,
        ...(config[nombre] ?? {}),
      }
    }
    return tablas[nombre]
  }

  // Pre-crea las tablas configuradas para que el test pueda leerlas siempre.
  for (const nombre of Object.keys(config)) tabla(nombre)

  const client = {
    from(nombre: string) {
      const t = tabla(nombre)

      const resultado = (data: any) =>
        Promise.resolve({ data, error: t.error ?? null })

      const builder: any = {
        insert(payload: Row | Row[]) {
          const filas = Array.isArray(payload) ? payload : [payload]
          if (!t.error) t.inserted.push(...filas)
          return {
            select: () => ({
              single: () => resultado(t.rows[0] ?? null),
              then: (fn: any) => resultado(t.rows).then(fn),
            }),
            then: (fn: any) => resultado(null).then(fn),
          }
        },
        upsert(payload: Row | Row[]) {
          const filas = Array.isArray(payload) ? payload : [payload]
          if (!t.error) t.upserted.push(...filas)
          return { then: (fn: any) => resultado(null).then(fn) }
        },
        update(payload: Row) {
          if (!t.error) t.updated.push(payload)
          return {
            eq: () => ({ then: (fn: any) => resultado(null).then(fn) }),
          }
        },
        select() {
          return {
            eq: () => ({
              then: (fn: any) => resultado(t.rows).then(fn),
              eq: () => ({ then: (fn: any) => resultado(t.rows).then(fn) }),
            }),
          }
        },
      }
      return builder
    },
    _tablas: tablas,
  }

  return client
}

const TIPOS_AUTOMOTOR = [
  { id: "t-auto", codigo: "AUTO" },
  { id: "t-cam", codigo: "CAMIONETA" },
  { id: "t-uti", codigo: "UTILITARIO" },
]

describe("seedOrganizationFromRubro", () => {
  let client: ReturnType<typeof crearClienteFake>

  beforeEach(() => {
    client = crearClienteFake({
      tipos_dispositivo: { rows: TIPOS_AUTOMOTOR },
      checklist_templates: { rows: [{ id: "tpl-1" }] },
      organizations: { rows: [] },
      checklist_template_items: { rows: [] },
    })
  })

  it("siembra los tipos del pack elegido, no los de electrónica", async () => {
    await seedOrganizationFromRubro("org-1", "automotor", client as any)

    const codigos = client._tablas.tipos_dispositivo.upserted.map((r) => r.codigo)
    expect(codigos).toEqual(["AUTO", "CAMIONETA", "UTILITARIO"])
    expect(codigos).not.toContain("CELULAR")
  })

  it("estampa organization_id y es_base en cada tipo", async () => {
    await seedOrganizationFromRubro("org-1", "automotor", client as any)

    for (const fila of client._tablas.tipos_dispositivo.upserted) {
      expect(fila.organization_id).toBe("org-1")
      expect(fila.es_base).toBe(true)
    }
  })

  it("guarda el config del tipo como JSON", async () => {
    await seedOrganizationFromRubro("org-1", "automotor", client as any)

    const auto = client._tablas.tipos_dispositivo.upserted.find((r) => r.codigo === "AUTO")
    expect(auto?.config?.campos?.imei?.label).toBe("Patente")
    expect(auto?.config?.categoriasInventario).toContain("Frenos")
  })

  it("escribe el vocabulario del rubro en la organización", async () => {
    await seedOrganizationFromRubro("org-1", "automotor", client as any)

    const update = client._tablas.organizations.updated[0]
    expect(update.terminologia.equipo).toBe("Vehículo")
    expect(update.terminologia.serie).toBe("Patente")
  })

  it("no toca el vocabulario cuando el pack no trae overrides", async () => {
    await seedOrganizationFromRubro("org-1", "electronica", client as any)
    expect(client._tablas.organizations.updated).toHaveLength(0)
  })

  it("crea un checklist por cada preset del pack", async () => {
    await seedOrganizationFromRubro("org-1", "automotor", client as any)

    const pack = getRubro("automotor")
    expect(client._tablas.checklist_templates.inserted).toHaveLength(pack.checklists.length)
    expect(client._tablas.checklist_templates.inserted[0].nombre).toBe("Recepción de vehículo")
  })

  it("vincula el checklist al tipo cuando el preset declara uno", async () => {
    const c = crearClienteFake({
      tipos_dispositivo: { rows: [{ id: "t-moto", codigo: "MOTO" }, { id: "t-bici", codigo: "BICICLETA" }] },
      checklist_templates: { rows: [{ id: "tpl-1" }] },
    })

    await seedOrganizationFromRubro("org-1", "motos-bicicletas", c as any)

    const templates = c._tablas.checklist_templates.inserted
    const moto = templates.find((t) => t.nombre === "Recepción de moto")
    const bici = templates.find((t) => t.nombre === "Recepción de bicicleta")
    expect(moto?.tipo_dispositivo_id).toBe("t-moto")
    expect(bici?.tipo_dispositivo_id).toBe("t-bici")
  })

  it("deja el checklist sin tipo cuando el preset no declara uno", async () => {
    await seedOrganizationFromRubro("org-1", "automotor", client as any)
    expect(client._tablas.checklist_templates.inserted[0].tipo_dispositivo_id).toBeNull()
  })

  it("inserta los items del checklist con su template_id", async () => {
    await seedOrganizationFromRubro("org-1", "automotor", client as any)

    const items = client._tablas.checklist_template_items.inserted
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(item.template_id).toBe("tpl-1")
    }
    expect(items.some((i) => i.label === "Kilometraje de ingreso")).toBe(true)
  })

  it("no siembra un checklist de celular en un taller mecánico", async () => {
    await seedOrganizationFromRubro("org-1", "automotor", client as any)

    const labels = client._tablas.checklist_template_items.inserted.map((i) => i.label)
    expect(labels).not.toContain("Pantalla táctil responde")
    expect(labels).not.toContain("Cargador incluido")
  })

  it("cae al pack genérico ante un rubro desconocido", async () => {
    const c = crearClienteFake({
      tipos_dispositivo: { rows: [{ id: "t-eq", codigo: "EQUIPO" }] },
      checklist_templates: { rows: [{ id: "tpl-1" }] },
    })

    const result = await seedOrganizationFromRubro("org-1", "plomeria", c as any)

    expect(result.rubroId).toBe("generico")
    expect(c._tablas.tipos_dispositivo.upserted.map((r) => r.codigo)).toEqual(["EQUIPO"])
  })

  it("cae al pack genérico cuando el rubro es null", async () => {
    const c = crearClienteFake({
      tipos_dispositivo: { rows: [{ id: "t-eq", codigo: "EQUIPO" }] },
      checklist_templates: { rows: [{ id: "tpl-1" }] },
    })

    const result = await seedOrganizationFromRubro("org-1", null, c as any)
    expect(result.rubroId).toBe("generico")
  })

  it("reporta el error sin lanzar cuando falla la siembra de tipos", async () => {
    const c = crearClienteFake({
      tipos_dispositivo: { error: { message: "boom" }, rows: [] },
      checklist_templates: { rows: [{ id: "tpl-1" }] },
    })

    const result = await seedOrganizationFromRubro("org-1", "automotor", c as any)

    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain("boom")
  })

  it("no crea checklists si no pudo resolver ningún tipo y el preset pide uno", async () => {
    const c = crearClienteFake({
      tipos_dispositivo: { rows: [] },
      checklist_templates: { rows: [{ id: "tpl-1" }] },
    })

    await seedOrganizationFromRubro("org-1", "motos-bicicletas", c as any)

    // Ambos presets de este pack declaran tipoCodigo; sin tipos resueltos
    // el vínculo quedaría colgado, así que se omiten.
    expect(c._tablas.checklist_templates.inserted).toHaveLength(0)
  })

  /**
   * `checklist_template_items.opciones` se guarda como JSON array: la UI de
   * checklist hace `JSON.parse(item.opciones)` en tres lugares (orden-form,
   * checklist-picker, checklist-form). Los presets historicos de
   * lib/onboarding/checklist-presets.ts venian separados por coma — nunca
   * exploto porque nadie los instalaba. La siembra normaliza el formato.
   */
  it("normaliza las opciones separadas por coma a JSON array", async () => {
    await seedOrganizationFromRubro("org-1", "automotor", client as any)

    const combustible = client._tablas.checklist_template_items.inserted.find(
      (i) => i.label === "Nivel de combustible"
    )
    expect(combustible?.opciones).toBe(
      JSON.stringify(["Reserva", "1/4", "1/2", "3/4", "Lleno"])
    )
  })

  it("deja en null las opciones de los items que no son SELECT", async () => {
    await seedOrganizationFromRubro("org-1", "automotor", client as any)

    const booleano = client._tablas.checklist_template_items.inserted.find(
      (i) => i.label === "Arranca correctamente"
    )
    expect(booleano?.opciones).toBeNull()
  })

  it("respeta las opciones que ya vienen como JSON array", async () => {
    await seedOrganizationFromRubro("org-1", "electronica", client as any)
    for (const item of client._tablas.checklist_template_items.inserted) {
      if (item.opciones === null) continue
      expect(() => JSON.parse(item.opciones)).not.toThrow()
      expect(Array.isArray(JSON.parse(item.opciones))).toBe(true)
    }
  })

  it("usa el detalle libre para nombrar el tipo del pack generico", async () => {
    const c = crearClienteFake({
      tipos_dispositivo: { rows: [{ id: "t-maq", codigo: "MAQUINA_DE_CAFE" }] },
      checklist_templates: { rows: [{ id: "tpl-1" }] },
    })

    await seedOrganizationFromRubro("org-1", "generico", c as any, "maquinas de cafe")

    const tipo = c._tablas.tipos_dispositivo.upserted[0]
    expect(tipo.codigo).toBe("MAQUINA_DE_CAFE")
    expect(tipo.nombre).toBe("Maquina de cafe")
    expect(c._tablas.organizations.updated[0].terminologia.equipo).toBe("Maquina de cafe")
  })

  it("ignora el detalle cuando el rubro es un pack curado", async () => {
    await seedOrganizationFromRubro("org-1", "automotor", client as any, "maquinas de cafe")

    const codigos = client._tablas.tipos_dispositivo.upserted.map((r) => r.codigo)
    expect(codigos).toEqual(["AUTO", "CAMIONETA", "UTILITARIO"])
  })

  it("cae al tipo EQUIPO si el detalle no sirve", async () => {
    const c = crearClienteFake({
      tipos_dispositivo: { rows: [{ id: "t-eq", codigo: "EQUIPO" }] },
      checklist_templates: { rows: [{ id: "tpl-1" }] },
    })

    await seedOrganizationFromRubro("org-1", "generico", c as any, "###")
    expect(c._tablas.tipos_dispositivo.upserted[0].codigo).toBe("EQUIPO")
  })

  it("devuelve el resumen de lo sembrado", async () => {
    const result = await seedOrganizationFromRubro("org-1", "automotor", client as any)

    expect(result.rubroId).toBe("automotor")
    expect(result.tiposSembrados).toBe(3)
    expect(result.checklistsCreados).toBe(1)
  })
})
