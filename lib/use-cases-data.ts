import {
  Smartphone,
  Monitor,
  Tv,
  type LucideIcon,
} from "lucide-react"

export interface UseCase {
  slug: string
  title: string
  metaTitle: string
  metaDescription: string
  icon: LucideIcon
  heroTitle: string
  heroHighlight: string
  heroDescription: string
  problems: string[]
  solutions: { title: string; description: string }[]
  keywords: string[]
}

export const useCases: UseCase[] = [
  {
    slug: "celulares",
    title: "Reparación de Celulares",
    metaTitle: "Software para Taller de Reparación de Celulares | STApp",
    metaDescription:
      "Sistema de gestión especializado para talleres de reparación de celulares. Órdenes de trabajo, seguimiento de reparaciones, inventario de repuestos y notificaciones por WhatsApp.",
    icon: Smartphone,
    heroTitle: "El software que tu taller de",
    heroHighlight: "reparación de celulares",
    heroDescription:
      "Gestioná órdenes de reparación de pantallas, baterías, placas y más. Documentá cada paso con fotos, controlá tu stock de repuestos y mantené a tus clientes informados por WhatsApp.",
    problems: [
      "Perdés el rastro de qué equipo está en qué estado",
      "Los clientes llaman todo el tiempo preguntando si su celular está listo",
      "No sabés cuántos repuestos te quedan hasta que te faltan",
      "Los presupuestos los hacés en papel o por WhatsApp sin registro",
    ],
    solutions: [
      {
        title: "Estados en tiempo real",
        description:
          "Cada orden tiene un estado claro: recibido, en diagnóstico, esperando repuesto, en reparación, listo, entregado. Vos y tu equipo saben exactamente qué pasa con cada equipo.",
      },
      {
        title: "Fotos por etapa",
        description:
          "Fotografiá el celular al recibirlo, durante la reparación y antes de entregarlo. Evidencia visual que te protege ante cualquier reclamo.",
      },
      {
        title: "Alertas de stock bajo",
        description:
          "Configurá el mínimo de cada repuesto (pantallas, baterías, flex, etc.) y recibí alertas automáticas antes de quedarte sin stock.",
      },
      {
        title: "Notificaciones WhatsApp",
        description:
          "Tu cliente recibe un mensaje automático cuando su equipo está listo. Sin llamadas, sin mensajes manuales.",
      },
    ],
    keywords: [
      "software reparación celulares",
      "sistema taller celulares",
      "gestión reparaciones celulares",
      "órdenes de trabajo celulares",
      "software taller de celulares",
      "inventario repuestos celulares",
    ],
  },
  {
    slug: "computadoras",
    title: "Reparación de Computadoras",
    metaTitle: "Software para Servicio Técnico de Computadoras | STApp",
    metaDescription:
      "Sistema de gestión para talleres de reparación de computadoras, notebooks y laptops. Control de órdenes, presupuestos, inventario de componentes y seguimiento de garantías.",
    icon: Monitor,
    heroTitle: "Gestión completa para tu servicio técnico de",
    heroHighlight: "computadoras",
    heroDescription:
      "Administrá reparaciones de PCs, notebooks y laptops. Desde el diagnóstico hasta la entrega con firma digital, todo queda documentado y trazable.",
    problems: [
      "Las reparaciones de computadoras llevan más tiempo y es difícil hacer seguimiento",
      "Necesitás registrar diagnósticos detallados con múltiples componentes",
      "Los presupuestos se complican cuando hay varias opciones de reparación",
      "Las garantías de componentes instalados se pierden sin un sistema",
    ],
    solutions: [
      {
        title: "Checklists de diagnóstico",
        description:
          "Creá checklists personalizados para cada tipo de equipo. RAM, disco, placa madre, fuente — todo queda registrado en la orden.",
      },
      {
        title: "Presupuestos con opciones",
        description:
          "Armá presupuestos profesionales con distintas alternativas de reparación. Tu cliente elige y aprueba con firma digital.",
      },
      {
        title: "Control de garantías",
        description:
          "Registrá la garantía de cada componente instalado. El sistema te avisa antes de que venzan y llevás el historial completo.",
      },
      {
        title: "Historial por equipo",
        description:
          "Cada PC o notebook tiene su historial completo: reparaciones anteriores, componentes cambiados y estados. Ideal para clientes recurrentes.",
      },
    ],
    keywords: [
      "software servicio técnico computadoras",
      "sistema reparación computadoras",
      "gestión taller computadoras",
      "software reparación notebooks",
      "servicio técnico PC",
      "sistema órdenes computadoras",
    ],
  },
  {
    slug: "electronicos",
    title: "Reparación de Electrónicos",
    metaTitle: "Software para Taller de Reparación de Electrónicos | STApp",
    metaDescription:
      "Sistema de gestión para talleres de reparación de dispositivos electrónicos: tablets, consolas, audio y más. Órdenes de trabajo, inventario y cobros en un solo lugar.",
    icon: Tv,
    heroTitle: "El sistema para talleres de",
    heroHighlight: "electrónicos y dispositivos",
    heroDescription:
      "Tablets, consolas, equipos de audio, cámaras — si lo reparás, STApp lo gestiona. Un solo sistema flexible para cualquier tipo de dispositivo electrónico.",
    problems: [
      "Cada dispositivo es diferente y necesitás flexibilidad en las órdenes",
      "Manejás muchos tipos de repuestos distintos y es difícil organizarlos",
      "Los clientes traen equipos variados y querés un historial unificado",
      "No encontrás un sistema que se adapte a tu tipo de taller",
    ],
    solutions: [
      {
        title: "Órdenes flexibles",
        description:
          "Campos personalizables para cualquier tipo de dispositivo. Agregá marca, modelo, número de serie y detalles específicos de cada equipo.",
      },
      {
        title: "Inventario por categorías",
        description:
          "Organizá repuestos por tipo de dispositivo, marca o proveedor. Encontrá lo que necesitás al instante sin importar la variedad.",
      },
      {
        title: "Un solo sistema",
        description:
          "No necesitás un software distinto para cada tipo de reparación. STApp se adapta a celulares, tablets, consolas, PCs y cualquier electrónico.",
      },
      {
        title: "Reportes por categoría",
        description:
          "Sabé qué tipo de reparaciones generan más ingresos, cuáles llevan más tiempo y dónde está la mayor demanda de tu taller.",
      },
    ],
    keywords: [
      "software reparación electrónicos",
      "sistema taller electrónica",
      "gestión reparaciones electrónicos",
      "software taller reparaciones",
      "sistema servicio técnico electrónica",
      "órdenes trabajo electrónicos",
    ],
  },
]

export function getUseCase(slug: string): UseCase | undefined {
  return useCases.find((uc) => uc.slug === slug)
}
