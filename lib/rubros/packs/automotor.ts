import type { RubroPack, RubroChecklistItem } from "../types"

const MARCAS = [
  "Ford", "Chevrolet", "Volkswagen", "Toyota", "Renault", "Fiat", "Peugeot",
  "Citroën", "Honda", "Nissan", "Jeep", "Hyundai", "Kia", "Mercedes-Benz", "BMW",
]

const ACCESORIOS = [
  { id: "rueda_auxilio", label: "Rueda de auxilio" },
  { id: "criquet", label: "Criquet y llave de rueda" },
  { id: "matafuegos", label: "Matafuegos" },
  { id: "balizas", label: "Balizas" },
  { id: "documentacion", label: "Documentación" },
  { id: "llaves_extra", label: "Llaves extra" },
  { id: "estereo_frente", label: "Frente de estéreo" },
]

const CATEGORIAS = [
  "Filtros", "Frenos", "Suspensión", "Motor", "Transmisión", "Eléctrico",
  "Neumáticos", "Lubricantes", "Correas", "Refrigeración", "Escape", "Otros",
]

const CAMPOS_VEHICULO = {
  // El identificador del vehículo es la patente: alfanumérica y corta,
  // nunca un IMEI de 15 dígitos.
  imei: { visible: true, label: "Patente", placeholder: "AB123CD" },
  password: { visible: false },
  color: { visible: true },
  marca: { visible: true },
} as const

const CHECKLIST_RECEPCION: RubroChecklistItem[] = [
  { label: "Estado de carrocería", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones leves,Abolladuras,Daño importante", orden: 1, requerido: true },
  { label: "Estado de neumáticos", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Buenos,Regulares,Gastados,A cambiar", orden: 2, requerido: true },
  { label: "Parabrisas y cristales", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Picaduras,Rajado,Roto", orden: 3, requerido: true },
  { label: "Kilometraje de ingreso", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 4, requerido: true },
  { label: "Nivel de combustible", tipo: "SELECT", categoria: "OTRO", opciones: "Reserva,1/4,1/2,3/4,Lleno", orden: 5, requerido: true },
  { label: "Arranca correctamente", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 6, requerido: true },
  { label: "Luces funcionan", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 7, requerido: true },
  { label: "Testigos encendidos en tablero", tipo: "TEXT", categoria: "FUNCIONAL", opciones: null, orden: 8, requerido: false },
  { label: "Frenos responden", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 9, requerido: false },
  { label: "Aire acondicionado funciona", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 10, requerido: false },
  { label: "Rueda de auxilio y criquet", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 11, requerido: true },
  { label: "Matafuegos y balizas", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 12, requerido: false },
  { label: "Documentación entregada", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 13, requerido: false },
  { label: "Objetos de valor en el interior", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 14, requerido: false },
  { label: "Observaciones adicionales", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 15, requerido: false },
]

const PROBLEMAS = [
  "No arranca", "Pierde aceite", "Pierde refrigerante", "Recalienta",
  "Ruido en la suspensión", "Falla el embrague", "Tironea al acelerar",
  "Se apaga en marcha", "Frenos hacen ruido", "El aire no enfría",
  "Testigo de motor encendido", "No carga la batería", "Cambio de correa",
  "Service de mantenimiento", "Alineación y balanceo",
]

export const automotor: RubroPack = {
  id: "automotor",
  nombre: "Taller mecánico / Automotor",
  descripcion: "Autos, camionetas y utilitarios. Mecánica general, service y diagnóstico.",
  icono: "Car",

  terminologia: {
    equipo: "Vehículo",
    equipoPlural: "Vehículos",
    orden: "Orden de trabajo",
    serie: "Patente",
    tecnico: "Mecánico",
    reparacion: "Reparación",
  },

  tipos: [
    {
      codigo: "AUTO",
      nombre: "Auto",
      prefijoOrden: "AUT",
      icono: "Car",
      orden: 1,
      config: {
        campos: CAMPOS_VEHICULO,
        camposExtra: [
          { key: "kilometraje", label: "Kilometraje", tipo: "text", placeholder: "Ej: 84500" },
          { key: "anio", label: "Año", tipo: "text", placeholder: "Ej: 2018" },
          { key: "combustible", label: "Combustible", tipo: "select", opciones: ["Nafta", "Diésel", "GNC", "Híbrido", "Eléctrico"] },
          { key: "transmision", label: "Transmisión", tipo: "buttons", opciones: ["Manual", "Automática"] },
          { key: "chasis", label: "N° de chasis", tipo: "text", placeholder: "Opcional" },
        ],
        accesorios: ACCESORIOS,
        problemasComunes: PROBLEMAS,
        marcas: MARCAS,
        categoriasInventario: CATEGORIAS,
        infoSectionTitle: "Datos del vehículo",
      },
    },
    {
      codigo: "CAMIONETA",
      nombre: "Camioneta / SUV",
      prefijoOrden: "CAM",
      icono: "Truck",
      orden: 2,
      config: {
        campos: CAMPOS_VEHICULO,
        camposExtra: [
          { key: "kilometraje", label: "Kilometraje", tipo: "text", placeholder: "Ej: 84500" },
          { key: "anio", label: "Año", tipo: "text", placeholder: "Ej: 2018" },
          { key: "combustible", label: "Combustible", tipo: "select", opciones: ["Nafta", "Diésel", "GNC", "Híbrido", "Eléctrico"] },
          { key: "traccion", label: "Tracción", tipo: "buttons", opciones: ["4x2", "4x4"] },
        ],
        accesorios: ACCESORIOS,
        problemasComunes: PROBLEMAS,
        marcas: MARCAS,
        categoriasInventario: CATEGORIAS,
        infoSectionTitle: "Datos del vehículo",
      },
    },
    {
      codigo: "UTILITARIO",
      nombre: "Utilitario",
      prefijoOrden: "UTI",
      icono: "Truck",
      orden: 3,
      config: {
        campos: CAMPOS_VEHICULO,
        camposExtra: [
          { key: "kilometraje", label: "Kilometraje", tipo: "text", placeholder: "Ej: 84500" },
          { key: "anio", label: "Año", tipo: "text", placeholder: "Ej: 2018" },
          { key: "combustible", label: "Combustible", tipo: "select", opciones: ["Nafta", "Diésel", "GNC"] },
          { key: "carga", label: "Carga máxima", tipo: "text", placeholder: "Opcional" },
        ],
        accesorios: ACCESORIOS,
        problemasComunes: PROBLEMAS,
        marcas: MARCAS,
        categoriasInventario: CATEGORIAS,
        infoSectionTitle: "Datos del vehículo",
      },
    },
  ],

  checklists: [
    { nombre: "Recepción de vehículo", tipoCodigo: null, items: CHECKLIST_RECEPCION },
  ],
}
