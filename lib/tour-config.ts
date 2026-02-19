import type { DriveStep } from "driver.js"

export const TOUR_STORAGE_KEY = "stapp_tour_completed"

export const tourSteps: DriveStep[] = [
  {
    element: "#nav-dashboard",
    popover: {
      title: "Dashboard",
      description:
        "Tu panel principal con el resumen de órdenes, ingresos y actividad reciente de tu taller.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#nav-ordenes",
    popover: {
      title: "Órdenes de Servicio",
      description:
        "Creá y gestioná las órdenes de reparación. Seguí el estado de cada dispositivo desde que ingresa hasta que se entrega.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#nav-clientes",
    popover: {
      title: "Clientes",
      description:
        "Administrá tu base de clientes con sus datos de contacto, historial de reparaciones y compras.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#nav-tecnicos",
    popover: {
      title: "Técnicos",
      description:
        "Asigná técnicos a las reparaciones y seguí su rendimiento y órdenes asignadas.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#nav-vendedores",
    popover: {
      title: "Vendedores",
      description:
        "Gestioná tu equipo de ventas, sus comisiones y el registro de ventas realizadas.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#nav-ventas",
    popover: {
      title: "Ventas",
      description:
        "Registrá ventas de productos y servicios, con detalle de pagos y generación de comprobantes.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#nav-inventario",
    popover: {
      title: "Inventario",
      description:
        "Controlá el stock de repuestos, accesorios y productos. Gestioná precios y categorías.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#nav-facturacion",
    popover: {
      title: "Facturación",
      description:
        "Generá facturas, registrá pagos parciales y llevá el control de la cobranza.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#nav-reportes",
    popover: {
      title: "Reportes",
      description:
        "Visualizá estadísticas e informes detallados de ingresos, reparaciones y rendimiento de tu taller.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#nav-soporte",
    popover: {
      title: "Soporte",
      description:
        "Reportá errores, enviá sugerencias o hacé consultas directamente al equipo de STApp.",
      side: "right",
      align: "start",
    },
  },
]
