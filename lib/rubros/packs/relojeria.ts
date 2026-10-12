import type { RubroPack, RubroChecklistItem } from "../types"

const CHECKLIST_RELOJ: RubroChecklistItem[] = [
  { label: "Estado de la caja", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones leves,Rayones profundos,Abollada", orden: 1, requerido: true },
  { label: "Estado del cristal", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayado,Fisurado,Roto", orden: 2, requerido: true },
  { label: "Estado de la malla", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Gastada,Eslabones faltantes,Rota", orden: 3, requerido: true },
  { label: "Funciona al ingresar", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 4, requerido: true },
  { label: "Corona y pulsadores responden", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 5, requerido: true },
  { label: "Calendario funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 6, requerido: false },
  { label: "Cronógrafo funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 7, requerido: false },
  { label: "Piezas entregadas por el cliente", tipo: "TEXT", categoria: "ACCESORIOS", opciones: null, orden: 8, requerido: false },
  { label: "Caja y certificado originales", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 9, requerido: false },
  { label: "Valor declarado por el cliente", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 10, requerido: false },
  { label: "Observaciones adicionales", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 11, requerido: false },
]

const CHECKLIST_JOYA: RubroChecklistItem[] = [
  { label: "Tipo de metal declarado", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Oro,Plata,Acero,Fantasía,A determinar", orden: 1, requerido: true },
  { label: "Peso al ingresar (gramos)", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 2, requerido: true },
  { label: "Piedras engarzadas", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Ninguna,Completas,Falta alguna,Flojas", orden: 3, requerido: true },
  { label: "Estado general", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Bueno,Rayada,Deformada,Rota", orden: 4, requerido: true },
  { label: "Cierre funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 5, requerido: false },
  { label: "Valor declarado por el cliente", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 6, requerido: true },
  { label: "Observaciones adicionales", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 7, requerido: false },
]

export const relojeria: RubroPack = {
  id: "relojeria",
  nombre: "Relojería y joyería",
  descripcion: "Relojes de pulsera y pared, joyas, arreglos y cambios de batería.",
  icono: "Watch",

  terminologia: {
    equipo: "Pieza",
    equipoPlural: "Piezas",
    orden: "Orden de trabajo",
    serie: "Número de serie",
    tecnico: "Relojero",
    reparacion: "Arreglo",
  },

  tipos: [
    {
      codigo: "RELOJ",
      nombre: "Reloj",
      prefijoOrden: "REL",
      icono: "Watch",
      orden: 1,
      config: {
        campos: {
          imei: { visible: true, label: "Número de serie", placeholder: "Grabado en la tapa" },
          password: { visible: false },
          color: { visible: true },
          marca: { visible: true },
        },
        camposExtra: [
          { key: "movimiento", label: "Movimiento", tipo: "select", opciones: ["Cuarzo", "Automático", "Cuerda manual", "Digital", "Híbrido"] },
          { key: "tipoMalla", label: "Malla", tipo: "select", opciones: ["Cuero", "Metal", "Silicona", "Tela", "Sin malla"] },
          { key: "sumergible", label: "¿Es sumergible?", tipo: "buttons", opciones: ["Sí", "No", "No sabe"] },
        ],
        accesorios: [
          { id: "caja_original", label: "Caja original" },
          { id: "certificado", label: "Certificado / Garantía" },
          { id: "eslabones", label: "Eslabones sueltos" },
          { id: "malla_repuesto", label: "Malla de repuesto" },
        ],
        problemasComunes: [
          "No anda", "Atrasa", "Adelanta", "Cambio de batería",
          "Cristal rayado o roto", "Corona floja", "Entró agua",
          "Malla rota", "Ajuste de malla", "No carga (automático)",
          "Limpieza de máquina", "Cambio de sello / hermeticidad",
        ],
        marcas: ["Casio", "Citizen", "Seiko", "Orient", "Tissot", "Bulova", "Swatch", "Festina", "Rolex", "Timex"],
        categoriasInventario: [
          "Baterías", "Cristales", "Mallas", "Coronas", "Máquinas",
          "Sellos", "Agujas", "Herramientas", "Otros",
        ],
      },
    },
    {
      codigo: "JOYA",
      nombre: "Joya",
      prefijoOrden: "JOY",
      icono: "Gem",
      orden: 2,
      config: {
        campos: {
          imei: { visible: false },
          password: { visible: false },
          color: { visible: true },
          marca: { visible: false },
        },
        camposExtra: [
          { key: "tipoPieza", label: "Tipo de pieza", tipo: "select", opciones: ["Anillo", "Cadena", "Pulsera", "Aros", "Dije", "Alianza", "Otro"] },
          { key: "metal", label: "Metal", tipo: "select", opciones: ["Oro 18k", "Oro 14k", "Plata 925", "Acero", "Fantasía", "A determinar"] },
          { key: "pesoGramos", label: "Peso (gramos)", tipo: "text", placeholder: "Ej: 4.2" },
          { key: "talle", label: "Talle / Medida", tipo: "text", placeholder: "Opcional" },
        ],
        accesorios: [
          { id: "estuche", label: "Estuche" },
          { id: "certificado", label: "Certificado" },
          { id: "piedras_sueltas", label: "Piedras sueltas" },
        ],
        problemasComunes: [
          "Soldadura", "Cambio de medida", "Pulido y baño",
          "Cambio de cierre", "Engarce de piedra", "Piedra floja",
          "Cadena cortada", "Grabado", "Tasación",
        ],
        marcas: [],
        categoriasInventario: [
          "Piedras", "Cierres", "Cadenas", "Insumos de soldadura",
          "Baños galvánicos", "Otros",
        ],
      },
    },
  ],

  checklists: [
    { nombre: "Recepción de reloj", tipoCodigo: "RELOJ", items: CHECKLIST_RELOJ },
    { nombre: "Recepción de joya", tipoCodigo: "JOYA", items: CHECKLIST_JOYA },
  ],
}
