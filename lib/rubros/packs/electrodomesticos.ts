import type { RubroPack } from "../types"
import { CHECKLIST_PRESETS } from "@/lib/onboarding/checklist-presets"

const ACCESORIOS_LINEA_BLANCA = [
  { id: "cable_poder", label: "Cable de alimentación" },
  { id: "manual", label: "Manual" },
  { id: "control_remoto", label: "Control remoto" },
  { id: "accesorios_originales", label: "Accesorios originales" },
  { id: "bandejas", label: "Bandejas / Estantes" },
]

const MARCAS = [
  "Whirlpool", "Drean", "Gafa", "Patrick", "Philco", "BGH", "Samsung", "LG",
  "Electrolux", "Longvie", "Peabody", "Atma", "Liliana", "Ariston", "Bosch",
]

const preset = CHECKLIST_PRESETS.find(
  (p) => p.tipoDispositivo === "_GENERICO_ELECTRODOMESTICO"
)

export const electrodomesticos: RubroPack = {
  id: "electrodomesticos",
  nombre: "Electrodomésticos y refrigeración",
  descripcion: "Heladeras, lavarropas, aires acondicionados, microondas y línea blanca.",
  icono: "Refrigerator",

  terminologia: {
    equipo: "Artefacto",
    equipoPlural: "Artefactos",
    serie: "Número de serie",
    tecnico: "Técnico",
  },

  tipos: [
    {
      codigo: "HELADERA",
      nombre: "Heladera / Freezer",
      prefijoOrden: "HEL",
      icono: "Refrigerator",
      orden: 1,
      config: {
        campos: {
          imei: { visible: true, label: "Número de serie", placeholder: "S/N del artefacto" },
          password: { visible: false },
          color: { visible: true },
          marca: { visible: true },
        },
        camposExtra: [
          { key: "tipoFrio", label: "Sistema", tipo: "select", opciones: ["Cíclica", "No Frost", "Frío húmedo", "No sabe"] },
          { key: "gas", label: "Gas refrigerante", tipo: "select", opciones: ["R134a", "R600a", "R290", "No sabe"] },
        ],
        accesorios: ACCESORIOS_LINEA_BLANCA,
        problemasComunes: [
          "No enfría", "Enfría poco", "Congela de más", "Pierde agua",
          "Hace ruido fuerte", "El motor no arranca", "Se escarcha",
          "No apaga nunca", "La puerta no cierra", "Burlete gastado",
        ],
        marcas: MARCAS,
        categoriasInventario: [
          "Compresores", "Termostatos", "Motores", "Gas refrigerante",
          "Burletes", "Resistencias", "Placas", "Otros",
        ],
      },
    },
    {
      codigo: "LAVARROPAS",
      nombre: "Lavarropas / Secarropas",
      prefijoOrden: "LAV",
      icono: "WashingMachine",
      orden: 2,
      config: {
        campos: {
          imei: { visible: true, label: "Número de serie", placeholder: "S/N del artefacto" },
          password: { visible: false },
          color: { visible: true },
          marca: { visible: true },
        },
        camposExtra: [
          { key: "carga", label: "Carga", tipo: "buttons", opciones: ["Frontal", "Superior"] },
          { key: "capacidad", label: "Capacidad", tipo: "select", opciones: ["5 kg", "6 kg", "7 kg", "8 kg", "9 kg o más", "No sabe"] },
        ],
        accesorios: ACCESORIOS_LINEA_BLANCA,
        problemasComunes: [
          "No carga agua", "No desagota", "No centrifuga", "Pierde agua",
          "No enciende", "Traba el programa", "Hace ruido al centrifugar",
          "La puerta no destraba", "Error en el display", "Golpea el tambor",
        ],
        marcas: MARCAS,
        categoriasInventario: [
          "Motores", "Bombas", "Correas", "Electroválvulas", "Placas",
          "Rodamientos", "Burletes", "Otros",
        ],
      },
    },
    {
      codigo: "AIRE_ACONDICIONADO",
      nombre: "Aire acondicionado",
      prefijoOrden: "AIRE",
      icono: "AirVent",
      orden: 3,
      config: {
        campos: {
          imei: { visible: true, label: "Número de serie", placeholder: "S/N del equipo" },
          password: { visible: false },
          color: { visible: false },
          marca: { visible: true },
        },
        camposExtra: [
          { key: "tipoEquipo", label: "Tipo", tipo: "select", opciones: ["Split", "Ventana", "Portátil", "Multi split", "Piso techo"] },
          { key: "frigorias", label: "Frigorías", tipo: "select", opciones: ["2200", "3000", "3500", "4500", "5500", "6000 o más", "No sabe"] },
          { key: "inverter", label: "¿Es inverter?", tipo: "buttons", opciones: ["Sí", "No", "No sabe"] },
        ],
        accesorios: [
          { id: "control_remoto", label: "Control remoto" },
          { id: "soporte", label: "Soporte" },
          { id: "manual", label: "Manual" },
        ],
        problemasComunes: [
          "No enfría", "No calienta", "Pierde agua", "No enciende",
          "Hace ruido", "Tira olor feo", "No responde el control",
          "Se apaga solo", "Error en el display", "Carga de gas",
          "Limpieza / service preventivo",
        ],
        marcas: [...MARCAS, "Surrey", "Carrier", "Midea", "TCL", "Hisense"],
        categoriasInventario: [
          "Compresores", "Filtros", "Motores", "Placas", "Gas refrigerante",
          "Turbinas", "Capacitores", "Otros",
        ],
      },
    },
    {
      codigo: "ELECTRODOMESTICO",
      nombre: "Otro electrodoméstico",
      prefijoOrden: "ELE",
      icono: "Microwave",
      orden: 4,
      config: {
        campos: {
          imei: { visible: true, label: "Número de serie", placeholder: "S/N del artefacto" },
          password: { visible: false },
          color: { visible: true },
          marca: { visible: true },
        },
        camposExtra: [
          { key: "tipoArtefacto", label: "Artefacto", tipo: "text", placeholder: "Microondas, cafetera, aspiradora…" },
        ],
        accesorios: ACCESORIOS_LINEA_BLANCA,
        problemasComunes: [
          "No enciende", "No calienta", "Hace ruido extraño", "Se apaga solo",
          "Pierde agua", "Cable dañado", "Mantenimiento preventivo",
        ],
        marcas: MARCAS,
        categoriasInventario: [
          "Motores", "Resistencias", "Placas", "Fusibles", "Cables",
          "Perillas", "Otros",
        ],
      },
    },
  ],

  checklists: [
    {
      nombre: "Recepción de artefacto",
      tipoCodigo: null,
      items: preset?.items ?? [],
    },
  ],
}
