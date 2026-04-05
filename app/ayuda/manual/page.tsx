"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  ArrowLeft,
  Search,
  BookOpen,
  ClipboardList,
  Package,
  FileText,
  Users,
  ChevronDown,
  LayoutDashboard,
  Wrench,
  ShoppingCart,
  Receipt,
  Calculator,
  BarChart3,
  Settings,
  Smartphone,
  Shield,
  Menu,
  X,
  Store,
  Truck,
  Mail,
  Headset,
  Bot,
  CreditCard,
  Monitor,
} from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────

type Role = "ADMIN" | "TECNICO" | "VENDEDOR"

interface ManualSection {
  id: string
  icon: React.ElementType
  title: string
  roles: Role[]
  content: ContentBlock[]
}

interface ContentBlock {
  subtitle: string
  body: string
  steps?: string[]
  tip?: string
  roles?: Role[]
}

// ─── Data ────────────────────────────────────────────────────────────────────

const roleBadgeColors: Record<Role, string> = {
  ADMIN: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
  TECNICO: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  VENDEDOR: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
}

const sections: ManualSection[] = [
  {
    id: "primeros-pasos",
    icon: BookOpen,
    title: "Primeros pasos",
    roles: ["ADMIN", "TECNICO", "VENDEDOR"],
    content: [
      {
        subtitle: "Crear tu cuenta",
        body: "Para registrarte en STApp, ingresá a stapp.com.ar y hacé clic en \"Comenzar Gratis\". Completá el formulario con tu nombre, email y contraseña. También podés registrarte con tu cuenta de Google para mayor comodidad. Recibirás un email de verificación que deberás confirmar para activar tu cuenta.",
        steps: [
          "Ingresá a stapp.com.ar y hacé clic en \"Comenzar Gratis\"",
          "Completá tu nombre, email y contraseña (o usá Google)",
          "Verificá tu email haciendo clic en el enlace que te enviamos",
          "Completá los datos de tu organización (nombre del taller, dirección, teléfono)",
          "¡Listo! Ya podés empezar a usar STApp con 30 días gratis",
        ],
      },
      {
        subtitle: "Configuración inicial del taller",
        body: "Una vez creada tu cuenta, te recomendamos seguir el asistente de configuración inicial (onboarding) que te guiará paso a paso. Podés cargar datos de ejemplo para explorar las funciones antes de ingresar tu información real.",
        steps: [
          "Completá los datos de tu empresa en Configuración > General",
          "Subí el logo de tu taller (aparecerá en órdenes, presupuestos y facturas)",
          "Agregá tus técnicos y vendedores desde las secciones correspondientes",
          "Cargá tu inventario de repuestos",
          "Configurá las plantillas de checklist de recepción",
          "Configurá la integración con WhatsApp si querés enviar notificaciones",
        ],
        tip: "Podés cargar datos de ejemplo durante el onboarding para familiarizarte con el sistema antes de ingresar datos reales.",
        roles: ["ADMIN"],
      },
      {
        subtitle: "Roles y permisos",
        body: "STApp maneja tres roles con distintos niveles de acceso. El Administrador tiene acceso completo a todas las funciones. El Técnico puede gestionar órdenes asignadas, ver clientes y cotizaciones. El Vendedor puede gestionar ventas, clientes, POS y proveedores.",
        steps: [
          "Administrador (ADMIN): acceso total — órdenes, inventario, facturación, reportes, configuración, técnicos, vendedores, caja y más",
          "Técnico (TECNICO): órdenes asignadas, clientes, cotizaciones y dashboard",
          "Vendedor (VENDEDOR): ventas, POS, clientes, proveedores, reportes de ventas y dashboard",
        ],
        tip: "Solo los administradores pueden agregar o modificar usuarios y cambiar la configuración del sistema.",
      },
      {
        subtitle: "Navegación general",
        body: "STApp tiene una barra lateral (sidebar) en escritorio y un menú inferior en dispositivos móviles. La barra lateral se puede colapsar para ganar espacio. En móvil, los 4 accesos principales están en la barra inferior y el resto en el menú \"Más\".",
      },
      {
        subtitle: "Autenticación en dos pasos (2FA)",
        body: "Para mayor seguridad, podés activar la verificación en dos pasos desde tu perfil. Al habilitarla, cada vez que inicies sesión se te pedirá un código adicional. También se generan códigos de respaldo por si perdés acceso a tu dispositivo.",
        tip: "Guardá los códigos de respaldo en un lugar seguro. Si perdés acceso a tu dispositivo de verificación, los vas a necesitar para ingresar.",
      },
    ],
  },
  {
    id: "dashboard",
    icon: LayoutDashboard,
    title: "Dashboard",
    roles: ["ADMIN", "TECNICO", "VENDEDOR"],
    content: [
      {
        subtitle: "Panel principal",
        body: "El Dashboard es tu centro de control. Muestra un resumen en tiempo real del estado de tu taller con métricas clave como: total de órdenes, órdenes pendientes, total de clientes, items con stock bajo, ingresos del mes y más.",
      },
      {
        subtitle: "Métricas y estadísticas",
        body: "Dependiendo de tu rol, verás distintas métricas:",
        steps: [
          "Órdenes por estado: distribución visual de pendientes, en reparación, completadas, etc.",
          "Ingresos de los últimos 7 días: gráfico de evolución de ingresos",
          "Ventas del día y del mes: totales actualizados en tiempo real",
          "Garantías por vencer: alertas de garantías próximas a expirar",
          "Órdenes con fecha de retiro vencida: para que no se te pase ningún equipo",
          "Distribución por técnico: carga de trabajo de cada técnico",
        ],
        roles: ["ADMIN"],
      },
      {
        subtitle: "Órdenes recientes",
        body: "En la parte inferior del dashboard verás las últimas órdenes creadas con su estado actual, permitiéndote acceder rápidamente a las más recientes.",
      },
    ],
  },
  {
    id: "ordenes",
    icon: ClipboardList,
    title: "Órdenes de servicio",
    roles: ["ADMIN", "TECNICO", "VENDEDOR"],
    content: [
      {
        subtitle: "Crear una orden",
        body: "Las órdenes de servicio son el corazón de STApp. Para crear una nueva orden, andá a la sección \"Órdenes\" y hacé clic en \"Nueva Orden\".",
        steps: [
          "Seleccioná o creá un cliente (podés buscarlo por nombre, teléfono o DNI)",
          "Completá los datos del equipo: tipo de dispositivo, marca, modelo y número de serie",
          "Describí el problema reportado por el cliente",
          "Asigná un técnico responsable",
          "Opcionalmente: establecé una fecha estimada de entrega, definí un presupuesto y completá el checklist de recepción",
          "Hacé clic en \"Crear Orden\" — se asignará un número automático",
        ],
        tip: "Podés tomar fotos del equipo al momento de la recepción para documentar el estado inicial. Esto es útil ante reclamos.",
      },
      {
        subtitle: "Estados de una orden",
        body: "Cada orden pasa por distintos estados que reflejan el progreso de la reparación:",
        steps: [
          "PENDIENTE: la orden fue creada y espera ser atendida",
          "EN REPARACIÓN: el técnico está trabajando en el equipo",
          "ESPERANDO REPUESTOS: se necesita un repuesto que no está en stock",
          "COMPLETADA: la reparación fue finalizada, el equipo está listo para retirar",
          "ENTREGADA: el cliente ya retiró su equipo",
          "CANCELADA: la orden fue cancelada",
        ],
      },
      {
        subtitle: "Gestión de repuestos en la orden",
        body: "Desde el detalle de una orden podés agregar repuestos del inventario. El sistema descuenta automáticamente el stock y registra el movimiento. El costo del repuesto se toma del precio de compra para calcular correctamente la ganancia.",
        steps: [
          "Abrí el detalle de la orden",
          "En la sección \"Repuestos\", hacé clic en \"Agregar repuesto\"",
          "Buscá el item en el inventario y seleccionalo",
          "Indicá la cantidad necesaria",
          "El sistema verifica stock disponible, descuenta y registra el movimiento automáticamente",
        ],
      },
      {
        subtitle: "Fotos de la orden",
        body: "Podés adjuntar fotos en tres momentos: al ingreso del equipo, durante la reparación y al momento de la entrega. Las fotos quedan asociadas a la orden y se pueden consultar en cualquier momento.",
        tip: "Documentar con fotos el estado del equipo al ingreso te protege ante reclamos por daños preexistentes.",
      },
      {
        subtitle: "Notificaciones al cliente",
        body: "Cuando cambiás el estado de una orden, podés notificar al cliente por WhatsApp con un solo clic. STApp usa plantillas predefinidas que incluyen automáticamente los datos de la reparación.",
      },
      {
        subtitle: "Seguimiento público",
        body: "Cada orden genera un enlace de seguimiento único que podés compartir con el cliente. Desde ahí, el cliente puede ver el estado actual de su reparación sin necesitar una cuenta en STApp.",
      },
      {
        subtitle: "Impresión / PDF de la orden",
        body: "Podés generar un PDF de la orden de servicio con todos los datos: cliente, equipo, diagnóstico, repuestos utilizados, costos y firma. Este PDF incluye el logo de tu taller configurado en el sistema.",
        roles: ["ADMIN", "TECNICO"],
      },
    ],
  },
  {
    id: "clientes",
    icon: Users,
    title: "Clientes",
    roles: ["ADMIN", "TECNICO", "VENDEDOR"],
    content: [
      {
        subtitle: "Gestión de clientes",
        body: "La sección de Clientes te permite mantener una base de datos completa con la información de cada cliente: nombre, teléfono, email, dirección y DNI. Podés buscar clientes por cualquiera de estos campos.",
      },
      {
        subtitle: "Crear un cliente",
        body: "Podés crear clientes de dos formas: desde la sección \"Clientes\" con el botón \"Nuevo Cliente\", o directamente al crear una orden de servicio o venta si el cliente no existe aún.",
        steps: [
          "Completá el nombre y al menos un dato de contacto (teléfono o email)",
          "El número de teléfono debe ser único por organización",
          "Opcionalmente agregá dirección y DNI",
        ],
      },
      {
        subtitle: "Historial del cliente",
        body: "Desde la ficha de cada cliente podés ver todo su historial: órdenes de servicio, ventas realizadas, estado de cuenta corriente y garantías activas. Esto te permite dar un servicio personalizado.",
      },
      {
        subtitle: "Cuenta corriente",
        body: "STApp lleva el registro de saldos pendientes de cada cliente. Podés ver cuánto debe cada cliente y gestionar los pagos parciales asociados a sus facturas.",
        roles: ["ADMIN"],
      },
      {
        subtitle: "Comunicación por WhatsApp",
        body: "Desde la ficha del cliente podés enviar un mensaje de WhatsApp directamente, abriendo una conversación con el número registrado.",
      },
    ],
  },
  {
    id: "tecnicos",
    icon: Wrench,
    title: "Técnicos",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Gestión de técnicos",
        body: "Desde esta sección podés agregar y administrar a los técnicos de tu taller. Cada técnico tiene un perfil con sus datos, especialidad y las órdenes que tiene asignadas.",
        steps: [
          "Hacé clic en \"Nuevo Técnico\"",
          "Completá nombre, email y datos de contacto",
          "Asigná el rol TECNICO",
          "El técnico recibirá un email para configurar su contraseña",
        ],
      },
      {
        subtitle: "Asignación de órdenes",
        body: "Podés asignar órdenes a cada técnico al crearlas o reasignarlas después. Desde el perfil del técnico podés ver todas sus órdenes activas y su carga de trabajo.",
      },
      {
        subtitle: "Métricas de rendimiento",
        body: "Visualizá la productividad de cada técnico: cantidad de órdenes completadas, tiempo promedio de reparación y distribución de estados de sus órdenes.",
      },
    ],
  },
  {
    id: "vendedores",
    icon: Store,
    title: "Vendedores",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Gestión de vendedores",
        body: "Similar a la sección de técnicos, acá podés gestionar a tu equipo de ventas. Cada vendedor tiene acceso al POS, ventas, clientes y proveedores.",
        steps: [
          "Hacé clic en \"Nuevo Vendedor\"",
          "Completá nombre, email y datos de contacto",
          "Asigná el rol VENDEDOR",
          "El vendedor recibirá un email para configurar su acceso",
        ],
      },
      {
        subtitle: "Rendimiento de ventas",
        body: "Desde el perfil de cada vendedor podés consultar sus ventas realizadas, montos totales y métricas de desempeño.",
      },
    ],
  },
  {
    id: "inventario",
    icon: Package,
    title: "Inventario",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Control de stock",
        body: "El módulo de inventario te permite gestionar todos tus repuestos y productos. Cada item tiene: código único, nombre, descripción, categoría, tipo de dispositivo compatible, precio de compra, precio de venta, stock actual y stock mínimo.",
      },
      {
        subtitle: "Agregar productos",
        body: "Para agregar un nuevo item al inventario:",
        steps: [
          "Andá a \"Inventario\" y hacé clic en \"Nuevo Item\"",
          "Completá el código (único por organización), nombre y descripción",
          "Seleccioná categoría y tipo de dispositivo",
          "Ingresá precio de compra y precio de venta a técnicos",
          "Definí el stock inicial y el stock mínimo para alertas",
          "Opcionalmente asigná un proveedor",
        ],
      },
      {
        subtitle: "Alertas de stock bajo",
        body: "Cuando un producto baja del stock mínimo configurado, aparece una alerta en el Dashboard y en la lista de inventario. Esto te ayuda a reponer antes de quedarte sin repuestos.",
        tip: "Configurá el stock mínimo en función de la demanda habitual de cada repuesto para evitar quedarte sin stock en momentos críticos.",
      },
      {
        subtitle: "Movimientos de inventario",
        body: "Cada entrada y salida de stock queda registrada automáticamente. Podés ver el historial completo de movimientos de cada item: salidas por órdenes de servicio, ventas, ajustes manuales y entradas por compras.",
      },
      {
        subtitle: "Importación masiva",
        body: "Si tenés muchos productos, podés importarlos masivamente desde un archivo Excel o CSV. Descargá la plantilla desde Configuración > Importaciones, completala con tus datos y subila al sistema.",
        steps: [
          "Andá a Configuración > Importaciones",
          "Descargá la plantilla de inventario (Excel/CSV)",
          "Completá los datos de tus productos siguiendo el formato",
          "Subí el archivo y revisá la vista previa",
          "Confirmá la importación",
        ],
      },
    ],
  },
  {
    id: "ventas",
    icon: ShoppingCart,
    title: "Ventas",
    roles: ["ADMIN", "VENDEDOR"],
    content: [
      {
        subtitle: "Registrar una venta",
        body: "La sección de Ventas te permite registrar ventas de productos y accesorios. Cada venta queda asociada a un cliente y un vendedor.",
        steps: [
          "Andá a \"Ventas\" y hacé clic en \"Nueva Venta\"",
          "Seleccioná el cliente (o creá uno nuevo)",
          "Agregá los productos del inventario con cantidad y precio",
          "Seleccioná el método de pago: efectivo, transferencia o tarjeta",
          "Opcionalmente aplicá descuentos",
          "Confirmá la venta",
        ],
      },
      {
        subtitle: "Métodos de pago",
        body: "STApp soporta tres métodos de pago: Efectivo, Transferencia bancaria y Tarjeta. Cada venta registra el método utilizado para facilitar la conciliación de caja.",
      },
      {
        subtitle: "Garantía de venta",
        body: "Al vender un producto, podés generar automáticamente una garantía de venta asociada. El período de garantía es configurable por item.",
      },
      {
        subtitle: "Anulación de ventas",
        body: "Si necesitás anular una venta, podés cambiar su estado a \"Anulada\". Esto es útil para corregir errores o procesar devoluciones.",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    id: "pos",
    icon: Monitor,
    title: "Punto de Venta (POS)",
    roles: ["ADMIN", "VENDEDOR"],
    content: [
      {
        subtitle: "Terminal de venta rápida",
        body: "El POS es una interfaz simplificada y rápida para registrar ventas en mostrador. Está diseñado para agilizar la atención al cliente con un flujo de cobro rápido.",
        steps: [
          "Abrí la sección \"POS\"",
          "Buscá y agregá productos al carrito",
          "Ajustá cantidades si es necesario",
          "Seleccioná el método de pago",
          "Confirmá la venta — el stock se actualiza automáticamente",
        ],
      },
    ],
  },
  {
    id: "cotizaciones",
    icon: FileText,
    title: "Cotizaciones / Presupuestos",
    roles: ["ADMIN", "TECNICO"],
    content: [
      {
        subtitle: "Crear una cotización",
        body: "Las cotizaciones te permiten enviar presupuestos formales a tus clientes antes de realizar una reparación o venta.",
        steps: [
          "Andá a \"Cotizaciones\" y hacé clic en \"Nueva Cotización\"",
          "Seleccioná el cliente",
          "Agregá los items con descripción, cantidad y precio unitario",
          "El sistema calcula automáticamente subtotales e IVA (21%)",
          "Opcionalmente agregá notas o condiciones",
          "Guardá como borrador o enviá directamente al cliente",
        ],
      },
      {
        subtitle: "Estados de cotización",
        body: "Las cotizaciones pasan por los siguientes estados:",
        steps: [
          "BORRADOR: en preparación, no visible para el cliente",
          "ENVIADA: enviada al cliente por email o enlace",
          "ACEPTADA: el cliente aceptó el presupuesto",
          "RECHAZADA: el cliente rechazó el presupuesto",
        ],
      },
      {
        subtitle: "Enlace público de cotización",
        body: "Cada cotización genera un enlace público único que podés compartir con el cliente. Desde ahí, el cliente puede ver el detalle, aceptar o rechazar el presupuesto, e incluso firmar digitalmente.",
      },
      {
        subtitle: "Convertir a factura",
        body: "Una vez aceptada, podés convertir la cotización en factura con un solo clic, trasladando todos los items y montos automáticamente.",
        roles: ["ADMIN"],
      },
      {
        subtitle: "Firma digital",
        body: "Las cotizaciones soportan firma digital del cliente. Al aceptar un presupuesto desde el enlace público, el cliente puede firmar directamente en pantalla.",
      },
    ],
  },
  {
    id: "facturacion",
    icon: Receipt,
    title: "Facturación",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Crear una factura",
        body: "El módulo de facturación te permite generar facturas asociadas a órdenes de servicio o independientes.",
        steps: [
          "Andá a \"Facturación\" y hacé clic en \"Nueva Factura\"",
          "Seleccioná el cliente",
          "Agregá los conceptos con descripción, cantidad y precio",
          "El sistema calcula IVA (21%) automáticamente",
          "Asigná un número de factura (manual)",
          "Guardá la factura",
        ],
      },
      {
        subtitle: "Pagos parciales",
        body: "STApp permite registrar pagos parciales en cada factura. El estado de pago se actualiza automáticamente:",
        steps: [
          "PENDIENTE: no se registraron pagos",
          "PAGADO PARCIAL: se registró al menos un pago pero queda saldo",
          "PAGADO: el total fue cubierto completamente",
        ],
      },
      {
        subtitle: "Generación de PDF",
        body: "Podés descargar cada factura en formato PDF con el logo de tu taller, datos del cliente, detalle de conceptos y totales. Ideal para enviar por email o WhatsApp.",
      },
      {
        subtitle: "Asociar a orden de servicio",
        body: "Podés vincular una factura a una orden de servicio para mantener la trazabilidad completa: desde la recepción del equipo hasta el cobro.",
      },
    ],
  },
  {
    id: "caja",
    icon: Calculator,
    title: "Caja",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Control de caja",
        body: "El módulo de Caja te permite llevar el control de los ingresos y egresos diarios de tu taller, separados por método de pago (efectivo, transferencia, tarjeta).",
      },
      {
        subtitle: "Cierre de caja",
        body: "Al final de cada jornada, podés realizar el cierre de caja para verificar que los montos registrados coincidan con el efectivo y transferencias reales.",
      },
      {
        subtitle: "Conciliación de pagos",
        body: "La caja muestra un resumen de todos los cobros del día agrupados por método de pago, facilitando la conciliación bancaria y el control de efectivo.",
      },
    ],
  },
  {
    id: "proveedores",
    icon: Truck,
    title: "Proveedores",
    roles: ["ADMIN", "VENDEDOR"],
    content: [
      {
        subtitle: "Gestión de proveedores",
        body: "Registrá y gestioná tus proveedores de repuestos y productos. Cada proveedor tiene: nombre, teléfono, WhatsApp, email, sitio web y notas.",
        steps: [
          "Andá a \"Proveedores\" y hacé clic en \"Nuevo Proveedor\"",
          "Completá los datos de contacto",
          "Opcionalmente agregá notas sobre condiciones de compra, tiempos de entrega, etc.",
        ],
      },
      {
        subtitle: "Asociación con inventario",
        body: "Al crear o editar un item de inventario, podés asignarle un proveedor. Esto te permite saber rápidamente a quién comprarle cuando necesitás reponer stock.",
      },
    ],
  },
  {
    id: "garantias",
    icon: Shield,
    title: "Garantías",
    roles: ["ADMIN", "TECNICO"],
    content: [
      {
        subtitle: "Garantía de servicio",
        body: "Cada orden de servicio completada puede tener una garantía asociada. El período de garantía es configurable y el sistema alerta cuando están próximas a vencer.",
      },
      {
        subtitle: "Reclamos de garantía",
        body: "Cuando un cliente vuelve con un problema cubierto por garantía, podés registrar un reclamo:",
        steps: [
          "Abrí la orden original y buscá la sección de garantía",
          "Hacé clic en \"Nuevo Reclamo\"",
          "Describí el motivo del reclamo",
          "El reclamo pasa por estados: PENDIENTE → EN REVISIÓN → ACEPTADO/RECHAZADO → RESUELTO",
          "Si se acepta, podés crear una nueva orden de reparación vinculada",
        ],
      },
      {
        subtitle: "Garantía de venta",
        body: "Los productos vendidos también pueden tener garantía. Se gestionan de forma independiente a las garantías de servicio, con su propio período y seguimiento.",
      },
      {
        subtitle: "Alertas de vencimiento",
        body: "El dashboard muestra las garantías próximas a vencer para que puedas anticiparte a posibles reclamos.",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    id: "reportes",
    icon: BarChart3,
    title: "Reportes",
    roles: ["ADMIN", "VENDEDOR"],
    content: [
      {
        subtitle: "Reportes básicos",
        body: "La sección de Reportes te ofrece visualizaciones y datos sobre el rendimiento de tu taller:",
        steps: [
          "Ingresos por rango de fechas",
          "Ventas por vendedor",
          "Órdenes por estado y por técnico",
          "Valorización del inventario",
          "Métricas de clientes",
        ],
      },
      {
        subtitle: "Reportes avanzados",
        body: "Los reportes avanzados permiten análisis más detallados con filtros personalizados, cruces de datos y exportación a Excel y PDF.",
        roles: ["ADMIN"],
      },
      {
        subtitle: "Exportación de datos",
        body: "Todos los reportes se pueden exportar en formato Excel o PDF para compartir con socios, contadores o para tu archivo.",
      },
    ],
  },
  {
    id: "emails",
    icon: Mail,
    title: "Emails",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Gestión de emails",
        body: "Desde esta sección podés ver el historial de emails enviados desde STApp: notificaciones de órdenes, cotizaciones enviadas, facturas y comunicaciones con clientes.",
      },
      {
        subtitle: "Plantillas de email",
        body: "STApp usa plantillas profesionales para cada tipo de comunicación. Los emails incluyen automáticamente el logo y datos de tu taller.",
      },
    ],
  },
  {
    id: "leads",
    icon: Bot,
    title: "Leads y Chatbot",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Chatbot Santi",
        body: "STApp incluye un chatbot con inteligencia artificial llamado \"Santi\" que puede interactuar con visitantes de tu sitio web, responder preguntas frecuentes y capturar datos de potenciales clientes.",
      },
      {
        subtitle: "Gestión de leads",
        body: "Los leads capturados por el chatbot se gestionan en esta sección. Cada lead pasa por estados:",
        steps: [
          "NUEVO: lead recién capturado",
          "CONTACTADO: ya te comunicaste con el potencial cliente",
          "CALIFICADO: el lead mostró interés real",
          "CONVERTIDO: se convirtió en cliente",
          "DESCARTADO: no era un lead válido o no tenía interés",
        ],
      },
      {
        subtitle: "Asignación y seguimiento",
        body: "Podés asignar leads a usuarios específicos para su seguimiento y agregar notas sobre cada interacción.",
      },
    ],
  },
  {
    id: "soporte",
    icon: Headset,
    title: "Soporte",
    roles: ["ADMIN", "TECNICO", "VENDEDOR"],
    content: [
      {
        subtitle: "Sistema de tickets",
        body: "Si tenés un problema o una sugerencia, podés crear un ticket de soporte directamente desde STApp. Nuestro equipo te responderá lo antes posible.",
        steps: [
          "Andá a \"Soporte\" y hacé clic en \"Nuevo Ticket\"",
          "Describí tu problema o sugerencia con el mayor detalle posible",
          "Opcionalmente adjuntá capturas de pantalla",
          "Enviá el ticket y recibirás una respuesta por email y dentro de la app",
        ],
      },
      {
        subtitle: "WhatsApp de soporte",
        body: "También podés contactarnos directamente por WhatsApp para consultas rápidas o urgentes.",
      },
    ],
  },
  {
    id: "configuracion",
    icon: Settings,
    title: "Configuración",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Datos de la empresa",
        body: "En Configuración > General podés editar los datos de tu organización: nombre, dirección, teléfono, email y logo. Estos datos aparecen en todas las comunicaciones y documentos generados (órdenes, facturas, cotizaciones).",
      },
      {
        subtitle: "Checklist de recepción",
        body: "Configurá plantillas de checklist personalizadas para la recepción de equipos. Podés definir los puntos a verificar según el tipo de dispositivo (celular, computadora, tablet, etc.).",
        steps: [
          "Andá a Configuración > Checklist",
          "Creá una nueva plantilla o editá una existente",
          "Agregá los items a verificar (pantalla, batería, botones, etc.)",
          "Asigná la plantilla a un tipo de dispositivo",
        ],
      },
      {
        subtitle: "Tipos de dispositivo",
        body: "Personalizá los tipos de dispositivo que manejás en tu taller. Por defecto STApp incluye: Celular, Computadora, Tablet, Consola y Smartwatch, pero podés agregar otros.",
      },
      {
        subtitle: "Integración WhatsApp",
        body: "Configurá la integración con WhatsApp Business API para enviar notificaciones automáticas a tus clientes cuando cambie el estado de una orden.",
        steps: [
          "Andá a Configuración > WhatsApp",
          "Seguí las instrucciones para vincular tu número de WhatsApp Business",
          "Configurá las plantillas de mensaje",
          "Activá las notificaciones automáticas que desees",
        ],
      },
      {
        subtitle: "Importación y exportación de datos",
        body: "Desde Configuración > Importaciones podés importar datos masivos de clientes, inventario y órdenes usando plantillas Excel/CSV. También podés exportar tus datos en cualquier momento.",
      },
      {
        subtitle: "Kiosco de seguimiento",
        body: "Configurá un kiosco público donde tus clientes puedan consultar el estado de su reparación ingresando el número de orden. Ideal para poner en una tablet en el mostrador de tu local.",
      },
      {
        subtitle: "Plan y suscripción",
        body: "En Configuración > Billing podés ver tu plan actual, los días restantes de prueba, cambiar de plan y gestionar tu método de pago a través de MercadoPago.",
      },
    ],
  },
  {
    id: "app-movil",
    icon: Smartphone,
    title: "App móvil",
    roles: ["ADMIN", "TECNICO", "VENDEDOR"],
    content: [
      {
        subtitle: "Opciones de acceso móvil",
        body: "STApp se puede usar en dispositivos móviles de tres formas:",
        steps: [
          "Navegador web: abrí stapp.com.ar desde Chrome o Safari en tu celular",
          "PWA (Progressive Web App): instalá STApp como aplicación desde el navegador para acceso rápido y notificaciones",
          "APK Android: descargá la app nativa para Android desde stapp.com.ar/descargar/android",
        ],
      },
      {
        subtitle: "Instalar como PWA",
        body: "Para instalar STApp como PWA en tu celular:",
        steps: [
          "Abrí stapp.com.ar en Chrome (Android) o Safari (iPhone)",
          "Tocá el menú del navegador (tres puntos o compartir)",
          "Seleccioná \"Agregar a pantalla de inicio\" o \"Instalar aplicación\"",
          "STApp aparecerá como un ícono en tu pantalla de inicio",
        ],
      },
      {
        subtitle: "Funciones offline",
        body: "La app móvil permite acceso básico sin conexión a internet. Los datos se sincronizan automáticamente cuando recuperás la conexión.",
      },
      {
        subtitle: "Navegación móvil",
        body: "En móvil, la navegación se adapta con una barra inferior con 4 accesos rápidos: Dashboard, Órdenes, Clientes e Inventario (según tu rol). El resto de las opciones están en el menú \"Más\".",
      },
    ],
  },
  {
    id: "seguridad",
    icon: Shield,
    title: "Seguridad y privacidad",
    roles: ["ADMIN", "TECNICO", "VENDEDOR"],
    content: [
      {
        subtitle: "Protección de datos",
        body: "STApp protege tu información con múltiples capas de seguridad:",
        steps: [
          "Encriptación HTTPS/TLS en todas las comunicaciones",
          "Aislamiento de datos por organización (Row Level Security)",
          "Copias de seguridad automáticas periódicas",
          "Monitoreo continuo de seguridad",
          "Control de acceso basado en roles",
        ],
      },
      {
        subtitle: "Autenticación segura",
        body: "Tu cuenta está protegida con contraseña encriptada, verificación de email obligatoria y la opción de activar autenticación en dos pasos (2FA) para mayor seguridad.",
      },
      {
        subtitle: "Privacidad de datos",
        body: "Tus datos y los de tus clientes son tuyos. STApp no comparte ni vende información a terceros. Podés exportar todos tus datos en cualquier momento y solicitar la eliminación de tu cuenta si lo deseás.",
      },
      {
        subtitle: "Multi-tenancy",
        body: "Cada organización opera en un entorno completamente aislado. Los datos de un taller nunca se mezclan con los de otro, garantizando total privacidad.",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    id: "suscripcion",
    icon: CreditCard,
    title: "Suscripción y pagos",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Período de prueba",
        body: "Al registrarte, tenés 30 días gratis con acceso completo a todas las funciones de STApp. No se requiere tarjeta de crédito para la prueba.",
      },
      {
        subtitle: "Planes disponibles",
        body: "STApp ofrece un plan Premium con todas las funciones incluidas. Podés elegir entre facturación mensual o anual (con descuento).",
      },
      {
        subtitle: "Métodos de pago",
        body: "Los pagos se procesan a través de MercadoPago, aceptando tarjetas de crédito, débito, efectivo y otros medios de pago disponibles en Argentina.",
      },
      {
        subtitle: "Cancelación",
        body: "Podés cancelar tu suscripción en cualquier momento sin penalidades. Mantendrás el acceso hasta el final del período ya facturado.",
      },
      {
        subtitle: "Gestión de suscripción",
        body: "Para gestionar tu suscripción, andá a Configuración > Billing. Ahí podés ver tu plan actual, cambiar de plan, actualizar el método de pago y ver el historial de pagos.",
      },
    ],
  },
]

// ─── Component ───────────────────────────────────────────────────────────────

export default function ManualPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeSection, setActiveSection] = useState("primeros-pasos")
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["primeros-pasos"])
  )
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeRole, setActiveRole] = useState<Role | null>(null)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const scrollToSection = (id: string) => {
    setActiveSection(id)
    if (!expandedSections.has(id)) {
      setExpandedSections((prev) => new Set(prev).add(id))
    }
    setSidebarOpen(false)
    setTimeout(() => {
      sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 100)
  }

  // Filter sections based on search and role
  const filteredSections = sections
    .filter((s) => (activeRole ? s.roles.includes(activeRole) : true))
    .map((section) => {
      if (!searchQuery) return section
      const query = searchQuery.toLowerCase()
      const matchTitle = section.title.toLowerCase().includes(query)
      const matchContent = section.content.some(
        (c) =>
          c.subtitle.toLowerCase().includes(query) ||
          c.body.toLowerCase().includes(query) ||
          c.steps?.some((step) => step.toLowerCase().includes(query))
      )
      if (!matchTitle && !matchContent) return null
      if (matchTitle) return section
      return {
        ...section,
        content: section.content.filter(
          (c) =>
            c.subtitle.toLowerCase().includes(query) ||
            c.body.toLowerCase().includes(query) ||
            c.steps?.some((step) => step.toLowerCase().includes(query))
        ),
      }
    })
    .filter(Boolean) as ManualSection[]

  // Expand all matching sections when search query changes
  const expandMatchingSections = useCallback(() => {
    if (searchQuery) {
      const ids = sections
        .filter((s) => (activeRole ? s.roles.includes(activeRole) : true))
        .filter((section) => {
          const query = searchQuery.toLowerCase()
          return (
            section.title.toLowerCase().includes(query) ||
            section.content.some(
              (c) =>
                c.subtitle.toLowerCase().includes(query) ||
                c.body.toLowerCase().includes(query) ||
                c.steps?.some((step) => step.toLowerCase().includes(query))
            )
          )
        })
        .map((s) => s.id)
      setExpandedSections(new Set(ids))
    }
  }, [searchQuery, activeRole])

  useEffect(() => {
    expandMatchingSections() // eslint-disable-line react-hooks/set-state-in-effect -- expanding sections on search is intentional
  }, [expandMatchingSections])

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden p-2 hover:bg-muted rounded-md"
              >
                {sidebarOpen ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Menu className="h-5 w-5" />
                )}
              </button>
              <Link href="/ayuda">
                <Button variant="ghost" size="sm" className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">Centro de Ayuda</span>
                </Button>
              </Link>
              <div className="hidden sm:block h-6 w-px bg-border" />
              <h1 className="text-lg font-bold text-foreground">
                Manual de Uso
              </h1>
            </div>

            {/* Search */}
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Buscar en el manual..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
          </div>

          {/* Role filter */}
          <div className="flex items-center gap-2 mt-3 pb-1 overflow-x-auto">
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              Filtrar por rol:
            </span>
            <button
              type="button"
              onClick={() => setActiveRole(null)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                !activeRole
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              Todos
            </button>
            {(["ADMIN", "TECNICO", "VENDEDOR"] as Role[]).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setActiveRole(activeRole === role ? null : role)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  activeRole === role
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {role === "TECNICO"
                  ? "Técnico"
                  : role === "VENDEDOR"
                    ? "Vendedor"
                    : "Administrador"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex gap-8 relative">
          {/* Sidebar - Desktop */}
          <aside className="hidden lg:block w-64 shrink-0">
            <nav className="sticky top-36 py-6 max-h-[calc(100vh-9rem)] overflow-y-auto">
              <ul className="space-y-1">
                {filteredSections.map((section) => (
                  <li key={section.id}>
                    <button
                      type="button"
                      onClick={() => scrollToSection(section.id)}
                      className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm transition-colors ${
                        activeSection === section.id
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <section.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{section.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          {/* Sidebar - Mobile */}
          {sidebarOpen && (
            <div className="fixed inset-0 z-40 lg:hidden">
              <div
                className="fixed inset-0 bg-black/50"
                onClick={() => setSidebarOpen(false)}
              />
              <aside className="fixed left-0 top-0 bottom-0 w-72 bg-card border-r shadow-xl z-50 overflow-y-auto pt-20 px-4 pb-6">
                <ul className="space-y-1">
                  {filteredSections.map((section) => (
                    <li key={section.id}>
                      <button
                        type="button"
                        onClick={() => scrollToSection(section.id)}
                        className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded-md text-sm transition-colors ${
                          activeSection === section.id
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        <section.icon className="h-4 w-4 shrink-0" />
                        <span>{section.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </aside>
            </div>
          )}

          {/* Main Content */}
          <main className="flex-1 min-w-0 py-6 pb-20">
            {filteredSections.length === 0 ? (
              <div className="text-center py-20">
                <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  No se encontraron resultados
                </h3>
                <p className="text-muted-foreground">
                  Probá con otros términos o cambiá el filtro de rol.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredSections.map((section) => {
                  const isExpanded = expandedSections.has(section.id)
                  return (
                    <div
                      key={section.id}
                      ref={(el) => { sectionRefs.current[section.id] = el }}
                      className="scroll-mt-36"
                    >
                      <Card>
                        <button
                          type="button"
                          onClick={() => {
                            toggleSection(section.id)
                            setActiveSection(section.id)
                          }}
                          className="flex items-center justify-between w-full px-6 py-4 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                              <section.icon className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <h2 className="text-lg font-semibold text-foreground">
                                {section.title}
                              </h2>
                              <div className="flex gap-1.5 mt-1">
                                {section.roles.map((role) => (
                                  <span
                                    key={role}
                                    className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${roleBadgeColors[role]}`}
                                  >
                                    {role === "TECNICO" ? "TÉCNICO" : role}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                          <ChevronDown
                            className={`h-5 w-5 text-muted-foreground transition-transform duration-200 ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                          />
                        </button>

                        {isExpanded && (
                          <CardContent className="px-6 pb-6 pt-0">
                            <div className="border-t pt-4 space-y-6">
                              {section.content
                                .filter((block) =>
                                  block.roles
                                    ? activeRole
                                      ? block.roles.includes(activeRole)
                                      : true
                                    : true
                                )
                                .map((block, i) => (
                                  <div key={i}>
                                    <h3 className="text-base font-semibold text-foreground mb-2">
                                      {block.subtitle}
                                    </h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                                      {block.body}
                                    </p>

                                    {block.steps && (
                                      <ol className="space-y-2 ml-1">
                                        {block.steps.map((step, j) => (
                                          <li
                                            key={j}
                                            className="flex gap-3 text-sm"
                                          >
                                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                                              {j + 1}
                                            </span>
                                            <span className="text-muted-foreground leading-relaxed">
                                              {step}
                                            </span>
                                          </li>
                                        ))}
                                      </ol>
                                    )}

                                    {block.tip && (
                                      <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg">
                                        <p className="text-sm text-amber-800 dark:text-amber-300">
                                          <span className="font-semibold">
                                            Consejo:{" "}
                                          </span>
                                          {block.tip}
                                        </p>
                                      </div>
                                    )}

                                    {block.roles && (
                                      <div className="flex gap-1.5 mt-3">
                                        {block.roles.map((role) => (
                                          <span
                                            key={role}
                                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${roleBadgeColors[role]}`}
                                          >
                                            {role === "TECNICO"
                                              ? "TÉCNICO"
                                              : role}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                            </div>
                          </CardContent>
                        )}
                      </Card>
                    </div>
                  )
                })}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
