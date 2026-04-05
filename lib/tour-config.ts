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
    element: "#nav-pos",
    popover: {
      title: "Punto de Venta (POS)",
      description:
        "Realizá ventas rápidas desde una interfaz tipo caja registradora, ideal para atención al mostrador.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#nav-cotizaciones",
    popover: {
      title: "Cotizaciones",
      description:
        "Creá presupuestos y cotizaciones para tus clientes antes de iniciar una reparación o venta.",
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
    element: "#nav-caja",
    popover: {
      title: "Caja",
      description:
        "Gestioná los movimientos de caja diarios: aperturas, cierres, ingresos y egresos de efectivo.",
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
    element: "#nav-emails",
    popover: {
      title: "Emails",
      description:
        "Configurá y gestioná los emails automáticos que se envían a tus clientes por cada etapa del servicio.",
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
  {
    element: "#nav-proveedores",
    popover: {
      title: "Proveedores",
      description:
        "Administrá tus proveedores, sus datos de contacto y el historial de compras.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#nav-configuracion",
    popover: {
      title: "Configuración",
      description:
        "Personalizá tu taller: datos del negocio, métodos de pago, estados de órdenes y más.",
      side: "right",
      align: "start",
    },
  },
]
