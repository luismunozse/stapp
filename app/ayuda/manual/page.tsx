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
  BookMarked,
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
  seeAlso?: string[]
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
        seeAlso: ["configuracion", "inventario", "tecnicos"],
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
        seeAlso: ["clientes", "configuracion"],
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
        seeAlso: ["inventario"],
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
        seeAlso: ["facturacion", "caja", "glosario"],
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
        seeAlso: ["ordenes", "ventas", "proveedores"],
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
        seeAlso: ["garantias"],
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
          "Agregá los items con descripción, cantidad y precio unitario (podés aplicar descuento por item)",
          "Opcionalmente aplicá un descuento global (en monto fijo o porcentaje)",
          "Elegí el porcentaje de IVA: 0%, 10.5%, 21% o 27% (según corresponda a tu actividad)",
          "Si trabajás con dólares, podés definir un tipo de cambio USD para mostrar el equivalente",
          "Opcionalmente agregá notas o condiciones",
          "Guardá como borrador o enviá directamente al cliente",
        ],
        tip: "El IVA en cotizaciones es configurable porque cada actividad y régimen fiscal usa una alícuota distinta. Si sos monotributista, dejalo en 0%.",
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
        seeAlso: ["facturacion"],
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
        body: "El módulo de facturación te permite generar facturas internas asociadas a órdenes de servicio o independientes. Importante: STApp emite documentos no fiscales (comprobantes internos para tu control), no facturas electrónicas AFIP. Los precios se cargan finales (sin discriminación de IVA).",
        steps: [
          "Andá a \"Facturación\" y hacé clic en \"Nueva Factura\"",
          "Seleccioná el cliente",
          "Agregá los conceptos con descripción, cantidad y precio final",
          "Asigná un número de factura (manual)",
          "Guardá la factura",
        ],
        tip: "Si necesitás emitir facturas electrónicas válidas para AFIP, usá tu sistema fiscal habitual. STApp te sirve para llevar el control interno, los pagos parciales y la cuenta corriente del cliente.",
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
        seeAlso: ["ordenes", "caja"],
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
        subtitle: "Cómo funciona la Caja",
        body: "El módulo de Caja unifica en una sola vista todos los movimientos de dinero del día: cobros de órdenes, ventas del POS, pagos de facturas, depósitos a cuenta corriente y movimientos manuales (ingresos y egresos). Cada movimiento queda registrado con su método de pago (Efectivo, Transferencia, Tarjeta Débito, Tarjeta Crédito, MercadoPago, Cuenta Corriente u Otro). Podés navegar día por día con las flechas y usar el botón \"Hoy\" para volver al día actual.",
        tip: "La Caja muestra siempre el dinero del día seleccionado. No es un saldo acumulado: es lo que entró y salió ese día.",
      },
      {
        subtitle: "Apertura de caja (sesión diaria)",
        body: "Para llevar un control formal con arqueo, podés abrir una sesión de caja al comenzar la jornada. Solo puede haber una sesión abierta por organización a la vez. Al abrir, indicás el saldo inicial en efectivo (el dinero con el que arranca el cajón).",
        steps: [
          "Andá a la sección \"Caja\"",
          "En el banner superior, hacé clic en \"Abrir Caja\"",
          "Ingresá el saldo inicial en efectivo (puede ser 0 si arrancás sin fondo)",
          "Confirmá — la sesión queda abierta y todos los movimientos del día se asocian a ella",
        ],
        tip: "Si trabajás con un fondo fijo (por ejemplo $10.000 para dar vuelto), ingresalo como saldo inicial. Esto te permite que el arqueo al cierre cuadre.",
      },
      {
        subtitle: "Movimientos manuales (ingresos y egresos)",
        body: "Además de los cobros automáticos (órdenes, ventas, facturas), podés registrar movimientos manuales desde la pestaña \"Movimientos Manuales\". Sirven para asentar gastos del día (insumos, pago a proveedor, retiros) o ingresos extra que no provienen de una venta.",
        steps: [
          "Andá a Caja > pestaña \"Movimientos Manuales\"",
          "Elegí Egreso o Ingreso",
          "Ingresá el monto y seleccioná el método de pago",
          "Elegí un concepto de la lista (o usá \"Otro\" para escribir uno personalizado)",
          "Para egresos: opcionalmente asigná una categoría de gasto y adjuntá el comprobante (foto o PDF)",
          "Hacé clic en \"Registrar Movimiento\"",
        ],
        tip: "Categorizar tus egresos es lo que permite que el Estado de Resultados muestre la ganancia neta correcta. Tomate el hábito de elegir categoría siempre que registres un gasto.",
        seeAlso: ["reportes", "configuracion"],
      },
      {
        subtitle: "Adjuntar comprobantes a los gastos",
        body: "Cuando cargás un egreso, podés adjuntar la foto o el PDF de la factura/recibo (hasta 5 MB, formatos JPG, PNG, WEBP o PDF). El comprobante queda asociado al movimiento y se puede consultar más tarde desde la lista de movimientos. Es muy útil ante pedidos del contador o para validar gastos en blanco.",
        tip: "Sacá la foto del ticket apenas lo recibís — si dejás los recibos para el final del día, suelen perderse o ilegibles.",
      },
      {
        subtitle: "Cierre de caja con arqueo",
        body: "Al final de la jornada cerrás la sesión haciendo un arqueo: el sistema calcula el efectivo esperado en el cajón (saldo inicial + ingresos en efectivo − egresos en efectivo) y vos ingresás el conteo físico real. STApp muestra automáticamente la diferencia (sobrante, faltante o caja cuadrada).",
        steps: [
          "En el banner de la caja abierta, hacé clic en \"Cerrar Caja\"",
          "Revisá el resumen: saldo inicial, ingresos en efectivo, egresos en efectivo, total esperado",
          "Contá el efectivo del cajón e ingresalo en \"Conteo físico\"",
          "El sistema muestra la diferencia en tiempo real: verde (cuadrada), ámbar (sobrante), rojo (faltante)",
          "Opcionalmente agregá observaciones (motivo del descuadre, notas del día, etc.)",
          "Confirmá el cierre — la sesión queda cerrada y queda registrada en el historial",
        ],
        tip: "Una diferencia chica de centavos suele ser por redondeos. Una diferencia grande indica un movimiento que faltó cargar, un cobro mal asentado o efectivo que se retiró sin registrarlo como egreso. Investigá antes de cerrar.",
      },
      {
        subtitle: "Historial de cierres",
        body: "Desde la pestaña \"Historial de Cierres\" podés consultar todas las sesiones cerradas anteriormente: fecha, usuario que abrió y cerró, saldo inicial, totales, conteo físico, diferencia y observaciones. Útil para auditar discrepancias o ver patrones de caja.",
      },
      {
        subtitle: "Filtros y exportación a CSV",
        body: "En la pestaña \"Resumen\" podés filtrar los movimientos por método de pago y por tipo (cobro de orden, venta, ingreso/egreso manual, etc.) para conciliar más rápido. Con el botón \"Exportar\" generás un CSV del día seleccionado para abrir en Excel o pasarle al contador.",
      },
      {
        subtitle: "Categorías de gasto",
        body: "Antes de empezar a categorizar gastos, configurá tus categorías desde Configuración > Categorías de Gasto. Podés crear categorías Fijas (alquiler, sueldos, servicios) y Variables (insumos, mantenimiento, fletes), asignarles color y decidir si \"afectan el resultado\".",
        steps: [
          "Andá a Configuración > Categorías de Gasto",
          "Hacé clic en \"Nueva\"",
          "Ingresá el nombre, elegí Fijo o Variable y un color",
          "Activá o desactivá \"Afecta el resultado\" según corresponda",
          "Guardá — la categoría queda disponible al cargar movimientos manuales",
        ],
        tip: "Desactivá \"Afecta el resultado\" para movimientos que salen de caja pero no son gastos del negocio (retiros del dueño, transferencias entre cuentas propias, devoluciones). Así el Estado de Resultados no los toma como pérdida.",
      },
      {
        subtitle: "Gastos recurrentes (plantillas mensuales)",
        body: "Para los gastos que se repiten siempre (alquiler, sueldos, internet, ABL), podés configurar una plantilla en Configuración > Gastos Recurrentes en lugar de cargarlos a mano cada mes. Definís concepto, monto, frecuencia (semanal, mensual o anual), día del mes y categoría. STApp avisa cuando vencen y los podés generar con un clic.",
        steps: [
          "Andá a Configuración > Gastos Recurrentes",
          "Hacé clic en \"Nuevo\" y completá: concepto, monto, método de pago, categoría, frecuencia y próximo vencimiento",
          "Guardá — la plantilla queda activa",
          "Cuando llega la fecha, el gasto aparece marcado como \"Vencido\" en ámbar",
          "Hacé clic en \"Generar vencidos\" para crear automáticamente los movimientos de caja correspondientes",
          "El sistema avanza la próxima fecha de vencimiento según la frecuencia",
        ],
        tip: "Podés pausar (sin eliminar) un gasto recurrente con el switch — útil para meses en que no corresponde (ej: aguinaldo, vacaciones).",
      },
      {
        subtitle: "Órdenes reparadas sin cobrar",
        body: "El resumen de caja muestra una lista destacada de órdenes que ya están reparadas o entregadas pero todavía tienen saldo pendiente de cobro. Te ayuda a no olvidarte de cobrar trabajos terminados.",
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
        subtitle: "Estado de Resultados (rentabilidad)",
        body: "El Estado de Resultados es el reporte de gestión más importante: te muestra cuánto realmente ganás. Calcula ingresos (ventas + servicios), costos de mercadería vendida (precio de compra al momento de la venta), ganancia bruta, gastos por categoría (fijos y variables) y ganancia neta final. Podés acceder desde Caja > pestaña \"Rentabilidad\" o desde Reportes.",
        steps: [
          "Elegí el período: mes actual, mes anterior, últimos 30 días o un rango personalizado",
          "El reporte muestra: Ingresos totales, Costo de mercadería, Ganancia bruta y margen %",
          "Debajo aparecen los gastos agrupados por categoría con su porcentaje sobre el total",
          "Al final: Ganancia neta y margen neto %",
          "Se compara automáticamente contra el período anterior equivalente (flecha de variación)",
          "Podés exportar el reporte para tu archivo o tu contador",
        ],
        tip: "Para que la ganancia bruta sea precisa, los items del inventario deben tener cargado el precio de compra. STApp guarda un \"snapshot\" del costo al momento de cada venta, así los reportes históricos no se distorsionan si después actualizás los precios.",
        roles: ["ADMIN"],
        seeAlso: ["caja", "inventario", "glosario"],
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
        seeAlso: ["suscripcion"],
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
    id: "glosario",
    icon: BookMarked,
    title: "Glosario",
    roles: ["ADMIN", "TECNICO", "VENDEDOR"],
    content: [
      {
        subtitle: "Arqueo de caja",
        body: "Acción de contar el efectivo físico al cierre de la jornada y compararlo con el efectivo que el sistema esperaba (saldo inicial + ingresos en efectivo − egresos en efectivo). Si los dos números coinciden, la caja \"cuadra\". Si no, hay sobrante o faltante.",
      },
      {
        subtitle: "Saldo inicial",
        body: "Dinero en efectivo con el que arranca una sesión de caja. Suele ser el fondo fijo que se usa para dar vuelto. Si arrancás sin fondo, ingresá 0.",
      },
      {
        subtitle: "Sobrante / Faltante",
        body: "Diferencia entre el efectivo contado físicamente y el esperado por el sistema. Sobrante = hay más plata en el cajón de la que el sistema preveía (puede indicar un cobro no asentado). Faltante = hay menos (puede indicar un egreso no registrado o un retiro no asentado).",
      },
      {
        subtitle: "Ganancia bruta vs Ganancia neta",
        body: "Ganancia bruta = ingresos − costo de la mercadería vendida (lo que pagaste por los repuestos/productos). Ganancia neta = ganancia bruta − todos los gastos del negocio (alquiler, sueldos, servicios, insumos, etc.). La neta es lo que realmente \"te queda\".",
      },
      {
        subtitle: "Margen bruto / margen neto",
        body: "Porcentaje que representa la ganancia sobre los ingresos. Margen bruto = ganancia bruta ÷ ingresos × 100. Margen neto = ganancia neta ÷ ingresos × 100. Sirven para medir rentabilidad de forma comparable mes a mes.",
      },
      {
        subtitle: "Costo de mercadería vendida (snapshot)",
        body: "STApp guarda el precio de compra de cada item al momento exacto en que se vende. Esto se llama \"snapshot de costo\". Sirve para que los reportes históricos sigan siendo correctos aunque después actualices los precios de compra.",
      },
      {
        subtitle: "Gasto fijo vs gasto variable",
        body: "Fijos: se repiten todos los meses sin importar cuánto trabajes (alquiler, sueldos, internet, servicios). Variables: dependen de la actividad (insumos, mantenimiento, fletes, comisiones). Esta separación te ayuda a entender cuál es tu \"piso\" mensual para no perder plata.",
      },
      {
        subtitle: "Categoría \"no afecta resultado\"",
        body: "Categoría de gasto marcada para que sus movimientos salgan de caja pero no se descuenten de la ganancia neta. Se usa para cosas que no son gastos del negocio: retiros del dueño, transferencias entre cuentas propias, devoluciones a clientes.",
      },
      {
        subtitle: "Gasto recurrente",
        body: "Plantilla de un gasto que se repite con una frecuencia conocida (semanal, mensual, anual). Cuando llega su fecha de vencimiento, podés generarlo en caja con un clic en lugar de cargarlo a mano cada vez.",
      },
      {
        subtitle: "Cuenta corriente",
        body: "Sistema de saldo pendiente con un cliente. Si un cliente retira un equipo o compra un producto y no paga el total, queda con saldo en cuenta corriente que podrá ir cancelando con pagos parciales.",
      },
      {
        subtitle: "Pago parcial",
        body: "Cobro a cuenta de una factura, venta u orden. El estado pasa a \"Pagado parcial\" hasta que la suma de los pagos cubra el total, momento en que pasa a \"Pagado\".",
      },
      {
        subtitle: "Estado de cobro de una orden",
        body: "Indica si un trabajo terminado ya fue pagado: PENDIENTE (no se cobró nada), PARCIAL (se cobró algo pero falta saldo), PAGADO (cobrado en su totalidad).",
      },
      {
        subtitle: "Documento no fiscal",
        body: "Comprobante interno que emite STApp para tu control y para entregar al cliente como recibo. No reemplaza la factura electrónica de AFIP — para eso seguís usando tu sistema fiscal.",
      },
      {
        subtitle: "PWA (Progressive Web App)",
        body: "Forma de instalar STApp en tu celular o computadora desde el navegador, sin pasar por una tienda de aplicaciones. Funciona como una app nativa: tiene ícono, abre a pantalla completa y permite cierto uso offline.",
      },
      {
        subtitle: "Multi-tenancy / aislamiento por organización",
        body: "STApp es una sola plataforma usada por muchos talleres a la vez, pero los datos de cada uno están completamente aislados. Ningún taller puede ver datos de otro, ni siquiera por error técnico.",
      },
      {
        subtitle: "2FA (autenticación en dos pasos)",
        body: "Capa extra de seguridad para iniciar sesión: además de tu contraseña, te pide un código que se genera en una app de tu celular (Google Authenticator, Authy, etc.). Hace mucho más difícil que alguien acceda a tu cuenta aunque sepa tu contraseña.",
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

const sectionsById = new Map(sections.map((s) => [s.id, s]))

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
    <div className="min-h-dvh bg-background">
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
        <div className="flex gap-4 md:gap-8 relative">
          {/* Sidebar - Desktop */}
          <aside className="hidden lg:block w-64 shrink-0">
            <nav className="sticky top-36 py-6 max-h-[calc(100dvh-9rem)] overflow-y-auto">
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

                                    {block.seeAlso && block.seeAlso.length > 0 && (
                                      <div className="flex flex-wrap items-center gap-1.5 mt-3">
                                        <span className="text-xs text-muted-foreground mr-1">
                                          Ver también:
                                        </span>
                                        {block.seeAlso.map((id) => {
                                          const target = sectionsById.get(id)
                                          if (!target) return null
                                          const Icon = target.icon
                                          return (
                                            <button
                                              key={id}
                                              type="button"
                                              onClick={() => scrollToSection(id)}
                                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs bg-muted hover:bg-primary/10 hover:text-primary transition-colors border"
                                            >
                                              <Icon className="h-3 w-3" />
                                              {target.title}
                                            </button>
                                          )
                                        })}
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
