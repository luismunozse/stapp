import type { RubroPack, RubroChecklistItem } from "../types"

const CHECKLIST_MOTO: RubroChecklistItem[] = [
  { label: "Estado de carenado / chasis", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones,Roto,Faltantes", orden: 1, requerido: true },
  { label: "Estado de neumáticos", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Buenos,Regulares,Gastados,A cambiar", orden: 2, requerido: true },
  { label: "Kilometraje de ingreso", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 3, requerido: true },
  { label: "Nivel de combustible", tipo: "SELECT", categoria: "OTRO", opciones: "Reserva,1/4,1/2,3/4,Lleno", orden: 4, requerido: false },
  { label: "Arranca correctamente", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 5, requerido: true },
  { label: "Luces y giros funcionan", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 6, requerido: true },
  { label: "Frenos responden", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 7, requerido: true },
  { label: "Espejos completos", tipo: "BOOLEAN", categoria: "ACCESORIOS", opciones: null, orden: 8, requerido: false },
  { label: "Casco / accesorios entregados", tipo: "TEXT", categoria: "ACCESORIOS", opciones: null, orden: 9, requerido: false },
  { label: "Observaciones adicionales", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 10, requerido: false },
]

const CHECKLIST_BICI: RubroChecklistItem[] = [
  { label: "Estado del cuadro", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones,Abollado,Fisurado", orden: 1, requerido: true },
  { label: "Estado de cubiertas", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Buenas,Regulares,Gastadas,A cambiar", orden: 2, requerido: true },
  { label: "Ruedas centradas", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 3, requerido: true },
  { label: "Frenos responden", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 4, requerido: true },
  { label: "Cambios pasan correctamente", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 5, requerido: true },
  { label: "Transmisión (cadena y piñones)", tipo: "SELECT", categoria: "FUNCIONAL", opciones: "Buena,Desgastada,A cambiar", orden: 6, requerido: false },
  { label: "Accesorios entregados", tipo: "TEXT", categoria: "ACCESORIOS", opciones: null, orden: 7, requerido: false },
  { label: "Observaciones adicionales", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 8, requerido: false },
]

export const motosBicicletas: RubroPack = {
  id: "motos-bicicletas",
  nombre: "Motos y bicicleterías",
  descripcion: "Motos, ciclomotores, bicicletas y rodados eléctricos.",
  icono: "Bike",

  terminologia: {
    equipo: "Rodado",
    equipoPlural: "Rodados",
    orden: "Orden de trabajo",
    serie: "Número de cuadro / motor",
    tecnico: "Mecánico",
  },

  tipos: [
    {
      codigo: "MOTO",
      nombre: "Moto",
      prefijoOrden: "MOT",
      icono: "Bike",
      orden: 1,
      config: {
        campos: {
          imei: { visible: true, label: "Patente / N° de motor", placeholder: "A123BCD" },
          password: { visible: false },
          color: { visible: true },
          marca: { visible: true },
        },
        camposExtra: [
          { key: "cilindrada", label: "Cilindrada", tipo: "select", opciones: ["110cc", "125cc", "150cc", "200cc", "250cc", "300cc o más"] },
          { key: "kilometraje", label: "Kilometraje", tipo: "text", placeholder: "Ej: 12400" },
          { key: "anio", label: "Año", tipo: "text", placeholder: "Ej: 2021" },
        ],
        accesorios: [
          { id: "casco", label: "Casco" },
          { id: "espejos", label: "Espejos" },
          { id: "baul", label: "Baúl" },
          { id: "documentacion", label: "Documentación" },
          { id: "llaves_extra", label: "Llaves extra" },
        ],
        problemasComunes: [
          "No arranca", "Pierde aceite", "No carga la batería", "Falla el embrague",
          "Cadena floja o gastada", "Frenos hacen ruido", "No pasa los cambios",
          "Se apaga en marcha", "Consume de más", "Service de mantenimiento",
        ],
        marcas: ["Honda", "Yamaha", "Zanella", "Motomel", "Corven", "Gilera", "Bajaj", "Keller", "Suzuki", "Kawasaki"],
        categoriasInventario: [
          "Filtros", "Frenos", "Transmisión", "Motor", "Eléctrico",
          "Cubiertas", "Lubricantes", "Cadenas", "Otros",
        ],
      },
    },
    {
      codigo: "BICICLETA",
      nombre: "Bicicleta",
      prefijoOrden: "BIC",
      icono: "Bike",
      orden: 2,
      config: {
        campos: {
          imei: { visible: true, label: "Número de cuadro", placeholder: "Grabado en el cuadro" },
          password: { visible: false },
          color: { visible: true },
          marca: { visible: true },
        },
        camposExtra: [
          { key: "rodado", label: "Rodado", tipo: "select", opciones: ["R12", "R16", "R20", "R24", "R26", "R27.5", "R29", "R700"] },
          { key: "tipoBici", label: "Tipo", tipo: "select", opciones: ["MTB", "Ruta", "Urbana", "Playera", "Plegable", "Infantil", "Eléctrica"] },
          { key: "cambios", label: "Cantidad de cambios", tipo: "text", placeholder: "Ej: 21" },
        ],
        accesorios: [
          { id: "luces", label: "Luces" },
          { id: "candado", label: "Candado" },
          { id: "portaequipaje", label: "Portaequipaje" },
          { id: "guardabarros", label: "Guardabarros" },
          { id: "bomba", label: "Inflador" },
          { id: "bateria", label: "Batería (eléctrica)" },
        ],
        problemasComunes: [
          "No pasan los cambios", "Frenos no responden", "Rueda desalineada",
          "Cadena salta", "Pinchadura", "Ruido en el pedaleo",
          "Manubrio flojo", "Cubierta gastada", "Armado de bicicleta nueva",
          "Service completo",
        ],
        marcas: ["Vairo", "Olmo", "Venzo", "SLP", "Trek", "Specialized", "Giant", "Firebird", "Zenith", "Philco"],
        categoriasInventario: [
          "Cubiertas", "Cámaras", "Frenos", "Transmisión", "Cadenas",
          "Rulemanes", "Manubrios", "Asientos", "Luces", "Otros",
        ],
      },
    },
  ],

  checklists: [
    { nombre: "Recepción de moto", tipoCodigo: "MOTO", items: CHECKLIST_MOTO },
    { nombre: "Recepción de bicicleta", tipoCodigo: "BICICLETA", items: CHECKLIST_BICI },
  ],
}
