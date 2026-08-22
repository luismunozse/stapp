// Contenido del manual de ayuda de STApp.
// Única fuente de verdad: lo consumen la página /ayuda/manual y el
// system prompt del asistente del panel (lib/asistente/system-prompt.ts).
// Mantener como data pura serializable — sin componentes React.

export type Role = "ADMIN" | "TECNICO" | "VENDEDOR"

export interface ContentBlock {
  subtitle: string
  body: string
  steps?: string[]
  tip?: string
  roles?: Role[]
  seeAlso?: string[]
}

export interface ManualSection {
  id: string
  title: string
  roles: Role[]
  content: ContentBlock[]
}

export const manualSections: ManualSection[] = [
  {
    id: "primeros-pasos",
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
          "Subí el logo de tu taller (aparecerá en órdenes, presupuestos y remitos)",
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
        body: "STApp maneja tres roles con distintos niveles de acceso. El Administrador tiene acceso completo. El Técnico trabaja sobre las órdenes. El Vendedor atiende el mostrador. Además de qué secciones ve cada uno, el rol define qué números de dinero se muestran.",
        steps: [
          "Administrador (ADMIN): acceso total — órdenes, inventario, servicios, compras, comprobantes, caja, finanzas, reportes, comisiones y configuración",
          "Técnico (TECNICO): órdenes, clientes, cotizaciones, agenda y su propio desempeño",
          "Vendedor (VENDEDOR): ventas, POS, clientes, proveedores, reportes de ventas y agenda",
          "Inventario para vendedores: viene apagado. El administrador puede habilitarlo desde Configuración > Módulos opcionales",
        ],
        tip: "Los costos son información sensible: el precio de compra solo se muestra a quien tiene acceso a inventario, y el costo y la ganancia de una cotización se muestran solo al administrador. El técnico ve el presupuesto y el total, no lo que te costó a vos.",
        seeAlso: ["inventario", "configuracion"],
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
        subtitle: "Recibir varios equipos de un mismo cliente",
        body: "Cuando un cliente trae más de un equipo, no hace falta cargar una orden por vez. Desde Órdenes > \"Recibir varios equipos\" cargás todos en una sola atención: los datos del cliente se tipean una vez, los términos y la firma se toman una sola vez, y STApp crea una orden independiente por equipo, cada una con su número, su seguimiento y su etiqueta.",
        steps: [
          "Andá a \"Órdenes\" y elegí \"Recibir varios equipos\"",
          "Seleccioná o creá el cliente y confirmá el teléfono de contacto",
          "Cargá cada equipo: tipo, marca, modelo o IMEI, color, falla reportada, accesorios y fotos",
          "Indicá quién recibe y agregá observaciones si corresponde",
          "Pedile al cliente que acepte los términos y firme una sola vez",
          "Confirmá: se crea una orden por equipo y un comprobante único con todos",
        ],
        tip: "La recepción de varios equipos necesita al menos 2 equipos y está disponible en el plan Profesional.",
        seeAlso: ["clientes", "suscripcion"],
      },
      {
        subtitle: "Código de acceso del dispositivo",
        body: "Si el equipo necesita PIN, patrón o contraseña para poder probarse, guardalo en la orden al momento de recibirlo. Queda disponible para el técnico y se imprime únicamente en el talón que se queda el taller — nunca en la copia que se lleva el cliente.",
        tip: "Pedí el código siempre que el equipo encienda: sin él, el técnico no puede verificar la reparación y el equipo vuelve al mostrador.",
      },
      {
        subtitle: "Estados de una orden",
        body: "Cada orden avanza por una máquina de estados: desde cada estado solo se puede pasar a los que tienen sentido, así nadie se saltea pasos por error.",
        steps: [
          "RECIBIDO: el equipo entró al taller y espera revisión",
          "EN DIAGNÓSTICO: el técnico está evaluando la falla",
          "PRESUPUESTADO: se cargó el presupuesto y se espera la respuesta del cliente",
          "APROBADO: el cliente aceptó el presupuesto",
          "EN REPARACIÓN: el técnico está trabajando en el equipo",
          "ESPERANDO REPUESTO: la reparación quedó pausada por falta de un repuesto",
          "REPARADO: el trabajo terminó y el equipo está listo para entregar",
          "SIN FALLA DETECTADA: se revisó y no se reproduce la falla que reportó el cliente",
          "SIN REPARACIÓN: no se puede reparar, o el cliente rechazó el presupuesto",
          "ENTREGADO: el cliente retiró el equipo reparado (final)",
          "ENTREGADO SIN REPARACIÓN: el cliente retiró el equipo sin reparar (final)",
          "ENTREGADO SIN COBRO: se entregó sin cobrar — cortesía, garantía, no reparable o sin falla (final)",
          "CANCELADO: la orden se dio de baja; se puede reactivar volviéndola a RECIBIDO",
        ],
        tip: "Los estados de entrega son finales: una vez entregado, el equipo no vuelve atrás. En cambio, desde REPARADO todavía podés volver a EN REPARACIÓN si aparece una falla antes de que el cliente lo retire.",
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
        subtitle: "Servicios realizados en la orden",
        body: "En el detalle de la orden, la pestaña \"Servicios\" es donde cargás el trabajo que se cobra, aparte de los repuestos que se pusieron. Podés elegir un servicio del catálogo o escribir uno a mano para ese caso puntual.",
        steps: [
          "Abrí la orden y andá a la pestaña \"Servicios\"",
          "Elegí un servicio del catálogo, o cargá uno manual con nombre y precio",
          "Indicá la cantidad",
          "Si el servicio manual lo vas a repetir seguido, marcá \"Guardar en Servicios\" y queda en el catálogo",
          "El subtotal de servicios se suma al monto de la orden",
        ],
        tip: "El precio del catálogo es un punto de partida, no una atadura: podés cambiarlo en el renglón y la orden guarda lo que cobraste de verdad. Si mañana actualizás la lista, las órdenes viejas no se mueven.",
        roles: ["ADMIN"],
        seeAlso: ["servicios", "cotizaciones"],
      },
      {
        subtitle: "Cómo impactan los servicios en el total",
        body: "Al agregar o quitar servicios, el monto de la orden se actualiza solo — y cuál se actualiza depende del estado: antes de APROBADO se mueve el presupuesto (todavía estás cotizando), y desde APROBADO se mueve el costo final (ya estás ejecutando). El total nunca puede quedar por debajo de lo que ya le cobraste al cliente.",
        tip: "Si querés sacar un servicio y el sistema no te deja, es porque el total quedaría por debajo de los pagos ya registrados. Revisá primero los cobros de esa orden.",
        roles: ["ADMIN"],
        seeAlso: ["caja", "servicios"],
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
        subtitle: "Marcar como Reparado y registrar el costo final",
        body: "Cuando pasás una orden a REPARADO, STApp te pide el costo final del trabajo. Lo hace en ese momento, y no antes, porque recién ahí sabés qué se usó de verdad. El diálogo te muestra el contexto para no equivocarte: el presupuesto que le pasaste al cliente, lo que ya cobraste de seña y lo que queda pendiente.",
        steps: [
          "Desde el detalle de la orden, cambiá el estado a REPARADO",
          "Revisá el presupuesto y la seña que muestra el diálogo",
          "Ingresá el costo final del trabajo",
          "Confirmá — la orden queda lista para entregar y podés imprimir la etiqueta",
        ],
        tip: "El cambio masivo de estado no incluye REPARADO justamente por esto: cada orden necesita su propio costo final.",
        roles: ["ADMIN", "TECNICO"],
        seeAlso: ["caja", "comisiones"],
      },
      {
        subtitle: "Entrega del equipo y cobro",
        body: "Al entregar, STApp confirma el total a cobrar y encadena el cobro: si queda saldo, te lleva directo a registrarlo con su método de pago, y el movimiento aparece en la caja del día. También podés dejar constancia con la firma del cliente y la del encargado.",
        steps: [
          "Desde la orden en estado REPARADO, elegí entregar",
          "Confirmá el total a cobrar (podés sumarle los repuestos usados)",
          "Tomá la firma del cliente y, si tu taller lo usa, la del encargado",
          "Registrá el cobro del saldo pendiente",
          "Si la entrega es sin cobro, elegí el motivo: no reparable, cortesía, garantía o el cliente desistió",
        ],
        tip: "Entregar sin cobrar es una decisión que queda registrada con su motivo. Sirve para que después puedas ver cuánto trabajo se fue en cortesías y garantías.",
        roles: ["ADMIN", "VENDEDOR"],
        seeAlso: ["caja", "clientes"],
      },
      {
        subtitle: "Etiqueta térmica del equipo",
        body: "Podés imprimir una etiqueta para pegar en el equipo, con el número de orden, el cliente, el equipo y un QR de seguimiento. Se imprime con el driver normal de tu impresora, así que funciona con cualquier etiquetadora o impresora de tickets.",
        steps: [
          "Elegí el tamaño: etiquetas troqueladas de 40×30, 50×30, 50×40 o 60×40 mm, o rollo continuo de 58 o 80 mm",
          "El tamaño elegido queda guardado en ese equipo para las próximas impresiones",
          "Imprimí al recibir el equipo, y de nuevo al marcarlo como REPARADO si querés identificar lo que está listo para entregar",
        ],
        tip: "Si la etiqueta sale cortada o corrida, casi siempre es el tamaño de papel del driver, no la app: revisá que coincida con el tamaño elegido acá.",
        roles: ["ADMIN", "TECNICO"],
        seeAlso: ["configuracion"],
      },
      {
        subtitle: "Comprobante de recepción y expediente de la orden",
        body: "La orden imprime en A4 como un expediente: los datos del cliente y del equipo, el checklist de recepción, el diagnóstico, los repuestos usados, los totales y los espacios de firma, con el logo de tu taller. La hoja de recepción trae además una línea de corte con el talón interno del taller (ahí va el código de acceso). La hoja de entrega incluye el conforme del cliente.",
        tip: "Guardá el talón: es tu respaldo de qué equipo entró, en qué estado y con qué accesorios.",
        roles: ["ADMIN", "TECNICO"],
        seeAlso: ["facturacion"],
      },
    ],
  },
  {
    id: "agenda",
    title: "Agenda",
    roles: ["ADMIN", "TECNICO", "VENDEDOR"],
    content: [
      {
        subtitle: "Para qué sirve la Agenda",
        body: "La Agenda es un calendario de turnos para todo lo que se coordina con día y hora: visitas de diagnóstico, reparaciones en el domicilio del cliente, retiros y entregas de equipos y mantenimientos programados. Es un módulo opcional: el administrador lo activa desde Configuración > Módulos opcionales.",
        tip: "Si trabajás solo en mostrador, dejala apagada — el menú queda más corto. Activala cuando empieces a salir a domicilio o a coordinar retiros.",
        seeAlso: ["configuracion"],
      },
      {
        subtitle: "Crear un turno",
        body: "Desde el calendario hacé clic en el horario que querés ocupar y completá el turno.",
        steps: [
          "Elegí el tipo: visita de diagnóstico, reparación en sitio, retiro de equipo, entrega de equipo o mantenimiento",
          "Definí inicio y fin, y la dirección si es a domicilio",
          "Asigná el técnico responsable (o dejalo sin asignar y resolvelo después)",
          "Vinculá el cliente y, si corresponde, el equipo",
          "Guardá — el turno aparece en el calendario con el color de su estado",
        ],
      },
      {
        subtitle: "Estados del turno",
        body: "Cada turno refleja en qué punto de la coordinación está:",
        steps: [
          "Agendado: reservado, todavía sin confirmar con el cliente",
          "Confirmado: el cliente confirmó día y hora",
          "En camino: el técnico salió hacia el domicilio",
          "Realizado: el turno se cumplió",
          "Orden generada: del turno salió una orden de servicio",
          "Cancelado / No se presentó: el turno no se concretó",
        ],
        tip: "Marcar los \"no se presentó\" te da, con el tiempo, el dato de cuántas horas de técnico se pierden en visitas fallidas.",
        seeAlso: ["ordenes"],
      },
      {
        subtitle: "Avisos al cliente",
        body: "Los turnos pueden avisarle al cliente por WhatsApp o email — confirmación y recordatorio — usando las plantillas de tu organización.",
        seeAlso: ["configuracion", "clientes"],
      },
    ],
  },
  {
    id: "clientes",
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
        body: "STApp lleva el registro de saldos pendientes de cada cliente. Podés ver cuánto debe cada cliente y gestionar los pagos parciales asociados a sus remitos.",
        roles: ["ADMIN"],
        seeAlso: ["facturacion", "caja", "glosario"],
      },
      {
        subtitle: "Tipo de precio: minorista o mayorista",
        body: "Cada cliente puede marcarse como Minorista (el caso normal) o Mayorista con un porcentaje de descuento propio. Cuando cargás una venta, un presupuesto o una orden para un cliente mayorista, STApp ya sugiere el precio con su descuento aplicado, en vez de dejarte hacer la cuenta a mano cada vez.",
        steps: [
          "Abrí la ficha del cliente y editala",
          "Elegí el tipo de precio: Minorista o Mayorista",
          "Si es mayorista, cargá su porcentaje de descuento",
          "Guardá — en la lista y en el buscador queda con la etiqueta \"Mayorista\"",
        ],
        tip: "Solo el administrador puede marcar un cliente como mayorista o cambiar su descuento. El vendedor lo ve y lo usa, pero no lo modifica.",
        roles: ["ADMIN"],
        seeAlso: ["ventas", "pos", "cotizaciones"],
      },
      {
        subtitle: "Comunicación por WhatsApp",
        body: "Desde la ficha del cliente podés enviar un mensaje de WhatsApp directamente, abriendo una conversación con el número registrado. Los mensajes salen de las plantillas de tu organización, con los datos ya completados.",
        seeAlso: ["configuracion"],
      },
      {
        subtitle: "Recordatorio de cobro",
        body: "Si el cliente tiene deuda, el diálogo de WhatsApp te ofrece un mensaje de recordatorio de cobro ya armado, con el total adeudado y el desglose entre cuenta corriente y órdenes pendientes. Vos revisás el texto antes de enviarlo.",
        tip: "Un recordatorio amable a los pocos días cobra mucho mejor que un reclamo a los dos meses. Aprovechá que el mensaje ya viene con los números correctos.",
        roles: ["ADMIN"],
        seeAlso: ["caja", "facturacion"],
      },
    ],
  },
  {
    id: "tecnicos",
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
    id: "comisiones",
    title: "Comisiones",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Cómo se liquidan las comisiones",
        body: "La sección Comisiones muestra, orden por orden, cuánto le corresponde a cada técnico. Una orden entra en la liquidación cuando está REPARADO o ENTREGADO y además está cobrada: mientras el cliente no pagó, no se genera comisión.",
        steps: [
          "Elegí el período y, si querés, filtrá por técnico",
          "La tabla muestra orden, equipo, costo final, costo de repuestos, ganancia, % de comisión y monto",
          "Filtrá por pendientes para ver solo lo que falta pagar",
          "Marcá las comisiones como pagadas, de a una o todas las pendientes juntas",
        ],
        tip: "La comisión se calcula sobre la ganancia (costo final menos repuestos), no sobre el total cobrado. Así un trabajo con muchos repuestos no infla la comisión.",
        seeAlso: ["tecnicos", "ordenes"],
      },
      {
        subtitle: "Órdenes entregadas sin reparar",
        body: "Por defecto no generan comisión. Si en tu negocio se cobra la revisión y querés reconocerla igual, activá \"Pagar comisión en órdenes sin reparación\" en Configuración > Módulos opcionales.",
        seeAlso: ["configuracion"],
      },
      {
        subtitle: "Comisiones de vendedores",
        body: "La pestaña de vendedores liquida sobre las ventas atribuidas a cada uno en el período, con el mismo circuito: ver pendientes y marcar como pagadas.",
        seeAlso: ["vendedores", "ventas"],
      },
    ],
  },
  {
    id: "inventario",
    title: "Inventario",
    roles: ["ADMIN", "VENDEDOR"],
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
        body: "Cada entrada y salida de stock queda registrada automáticamente. Podés ver el historial completo de movimientos de cada item: salidas por órdenes de servicio, ventas, ajustes manuales, entradas por compras y transferencias entre depósitos.",
        seeAlso: ["ordenes", "ventas", "compras"],
      },
      {
        subtitle: "Depósitos y sucursales",
        body: "Si guardás mercadería en más de un lugar (el mostrador, el taller, un depósito aparte), podés darlos de alta en Configuración > Depósitos y llevar el stock separado por cada uno. Las sucursales, en cambio, se configuran en Configuración > Sucursales y separan la operación completa: órdenes, ventas y personal.",
        tip: "Si vendés desde el POS y el stock no te cierra, revisá desde qué depósito está saliendo la mercadería. Tener stock repartido y no darse cuenta es la causa más común de \"stock insuficiente\" con el producto ahí en la vitrina.",
        roles: ["ADMIN"],
        seeAlso: ["configuracion", "pos"],
      },
      {
        subtitle: "Quién ve el inventario y los costos",
        body: "El inventario es del administrador por defecto. Si tus vendedores necesitan cargar productos o consultar stock, activá el permiso desde Configuración > Módulos opcionales; mientras esté apagado, la sección no aparece en su menú.",
        tip: "El permiso también decide quién ve el precio de compra. Al habilitarlo, el vendedor pasa a ver cuánto te costó cada producto — tenelo en cuenta antes de activarlo.",
        roles: ["ADMIN"],
        seeAlso: ["configuracion", "vendedores"],
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
    id: "servicios",
    title: "Servicios",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "El catálogo de servicios",
        body: "Tu taller no solo pone repuestos: cobra trabajo. Diagnósticos, instalaciones, mantenimientos, visitas a domicilio. Todo eso vive en Servicios, un catálogo aparte del inventario — porque un servicio no tiene stock: lo podés vender las veces que quieras sin que se te acabe.",
        steps: [
          "Andá a \"Servicios\" y creá uno nuevo",
          "Cargá el código (por ejemplo SRV-001) y el nombre (por ejemplo \"Instalación de Windows\")",
          "Opcionalmente agregá descripción y categoría para agruparlos",
          "Definí el precio de lista",
          "Opcionalmente indicá la duración estimada en minutos",
          "Dejalo Activo para que aparezca al cargar órdenes y cotizaciones",
        ],
        tip: "La duración estimada no es un adorno: es lo que después te deja ver si el precio que cobrás se banca las horas que se lleva el trabajo.",
        seeAlso: ["ordenes", "cotizaciones"],
      },
      {
        subtitle: "Quién carga y quién consulta",
        body: "Los precios son una decisión comercial, así que solo el administrador da de alta y edita servicios. El técnico sí puede consultar el catálogo, porque lo necesita para saber qué se ofrece y a cuánto.",
      },
      {
        subtitle: "Dar de baja sin perder el historial",
        body: "Un servicio que dejás de ofrecer no se borra: se desactiva. Deja de aparecer al cargar trabajo nuevo, pero las órdenes y cotizaciones que ya lo usaron siguen mostrando lo que se cobró en su momento.",
        tip: "Desactivar en vez de borrar es lo que mantiene sanos los reportes históricos. Si borrás, los números viejos dejan de cerrar.",
      },
    ],
  },
  {
    id: "ventas",
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
    title: "Punto de Venta (POS)",
    roles: ["ADMIN", "VENDEDOR"],
    content: [
      {
        subtitle: "Terminal de venta rápida",
        body: "El POS es una interfaz simplificada y rápida para registrar ventas en mostrador. Está diseñado para agilizar la atención al cliente con un flujo de cobro corto.",
        steps: [
          "Abrí la sección \"POS\"",
          "Buscá y agregá productos al carrito (por nombre, código o lector de códigos)",
          "Ajustá cantidades si es necesario",
          "Elegí el cliente si querés que la venta quede en su historial",
          "Seleccioná el método de pago",
          "Confirmá la venta — el stock se actualiza automáticamente",
        ],
      },
      {
        subtitle: "El precio cambia según cómo paga el cliente",
        body: "Si cobrás distinto según el medio de pago (efectivo más barato, tarjeta con recargo), configurá el porcentaje de cada método en Configuración > Recargos por método de pago. En el POS, al elegir el método, el total se ajusta solo: dejás de hacer la cuenta mental delante del cliente y de perder ese porcentaje por olvido.",
        tip: "El recargo es parte del precio de esa venta, no un adicional aparte: los reportes lo cuentan como ingreso real.",
        seeAlso: ["configuracion", "reportes"],
      },
      {
        subtitle: "Clientes mayoristas",
        body: "Si el cliente está marcado como mayorista, el POS ya sugiere el precio con su descuento aplicado. No hace falta acordarse del porcentaje de cada uno.",
        seeAlso: ["clientes"],
      },
      {
        subtitle: "Ticket para el cliente",
        body: "Al cerrar la venta podés imprimir el ticket en tu impresora térmica, con los datos del negocio, el detalle de los productos, el total y el método de pago. Soporta rollos de 58 y de 80 mm — elegí el que use tu impresora para que no salga cortado.",
        seeAlso: ["ventas", "facturacion"],
      },
    ],
  },
  {
    id: "catalogo",
    title: "Catálogo público",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Qué es el catálogo público",
        body: "El catálogo es una página pública, con su propia dirección, donde mostrás los productos y servicios que querés vender. El cliente entra desde un link o un QR, arma su pedido y te llega listo, sin que tengas que responder precio por precio en el chat.",
        steps: [
          "Items: qué se publica, con precio, foto y descripción",
          "Categorías: cómo se agrupan los items para el cliente",
          "Cupones: códigos de descuento para promociones puntuales",
          "Abandonados: carritos que alguien empezó y no confirmó",
          "Compartir: el link público y el QR para imprimir o mandar",
        ],
      },
      {
        subtitle: "Publicar y despublicar",
        body: "El catálogo tiene un interruptor de activación: mientras está apagado, el link no muestra nada. Cada item además se publica u oculta por separado, así podés prepararlo con calma y abrirlo cuando esté listo.",
        tip: "Antes de compartir el link, abrilo vos desde el celular: es exactamente lo que va a ver tu cliente.",
      },
      {
        subtitle: "Carritos abandonados",
        body: "Si alguien armó un pedido y no lo confirmó, queda registrado con lo que había elegido y cuánto sumaba. Desde ahí podés mandarle un mensaje para recuperar la venta, o descartarlo.",
        tip: "El carrito abandonado es la venta más barata de recuperar: el cliente ya eligió, solo se distrajo.",
        seeAlso: ["clientes", "ventas"],
      },
    ],
  },
  {
    id: "cotizaciones",
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
        subtitle: "Cotizar servicios del catálogo",
        body: "Al cargar los items podés elegir un servicio del catálogo en lugar de escribir la descripción a mano. La línea queda vinculada a ese servicio, así siempre cotizás con el mismo nombre y el mismo precio de lista, sin depender de cómo lo escribió cada uno.",
        seeAlso: ["servicios"],
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
        subtitle: "Costo y ganancia: solo el administrador",
        body: "Al armar una cotización podés cargar el costo de cada item para ver la ganancia bruta antes de mandar el presupuesto. Ese costo y esa ganancia se muestran únicamente al administrador: el técnico trabaja sobre el precio de venta y el total, sin ver el margen.",
        tip: "Si vinculás un item al inventario, el costo se toma del precio de compra actual — y se vuelve a tomar si después cambiás de producto, para que no quede un costo viejo pegado.",
        roles: ["ADMIN"],
        seeAlso: ["inventario", "reportes"],
      },
      {
        subtitle: "Enlace público de cotización",
        body: "Cada cotización genera un enlace público único que podés compartir con el cliente. Desde ahí, el cliente puede ver el detalle, aceptar o rechazar el presupuesto, e incluso firmar digitalmente.",
      },
      {
        subtitle: "Convertir a remito",
        body: "Una vez aceptada, podés convertir la cotización en remito con un solo clic, trasladando todos los items y montos automáticamente.",
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
    title: "Comprobantes",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Crear un remito",
        body: "El módulo de Comprobantes te permite generar remitos internos asociados a órdenes de servicio o independientes. Importante: STApp emite documentos no fiscales (comprobantes internos para tu control), no facturas electrónicas AFIP. Los precios se cargan finales (sin discriminación de IVA).",
        steps: [
          "Andá a \"Comprobantes\" y hacé clic en \"Generar remito\"",
          "Seleccioná el cliente",
          "Agregá los conceptos con descripción, cantidad y precio final",
          "Asigná un número de remito (manual)",
          "Guardá el remito",
        ],
        tip: "Si necesitás emitir facturas electrónicas válidas para AFIP, usá tu sistema fiscal habitual. STApp te sirve para llevar el control interno, los pagos parciales y la cuenta corriente del cliente.",
      },
      {
        subtitle: "Pagos parciales",
        body: "STApp permite registrar pagos parciales en cada remito. El estado de pago se actualiza automáticamente:",
        steps: [
          "PENDIENTE: no se registraron pagos",
          "PAGADO PARCIAL: se registró al menos un pago pero queda saldo",
          "PAGADO: el total fue cubierto completamente",
        ],
      },
      {
        subtitle: "El remito impreso",
        body: "El remito se descarga en PDF con formato clásico de comprobante A4: el encabezado con los datos de tu negocio y su logo, el bloque del cliente, el detalle de conceptos, los pagos registrados y el saldo pendiente como número principal, más el espacio de \"recibí conforme\". Sirve para mandarlo por email o WhatsApp, o para imprimirlo y entregarlo en mano.",
        tip: "Si el remito tiene muchos renglones, la impresión continúa en la hoja siguiente manteniendo el encabezado y los totales, así no queda un total suelto sin contexto.",
      },
      {
        subtitle: "Datos fiscales y de cobro en el comprobante",
        body: "Para que el remito salga completo, cargá una vez tus datos en Configuración > Datos fiscales y de cobro: CUIT, condición frente al IVA, domicilio fiscal, ingresos brutos e inicio de actividades, más los datos de cobro (CBU o alias, medios de pago aceptados y plazo de pago). A partir de ahí aparecen impresos en cada comprobante.",
        tip: "Poner el CBU o alias en el propio remito acorta el cobro: el cliente transfiere desde el mismo papel que le entregaste, sin tener que pedirte los datos.",
        seeAlso: ["configuracion", "caja"],
      },
      {
        subtitle: "Los servicios en el comprobante",
        body: "Cuando el comprobante sale de una orden, los servicios realizados se desglosan renglón por renglón junto con los repuestos. El cliente ve qué se le hizo al equipo, no solo un total que tiene que creerte.",
        seeAlso: ["servicios", "ordenes"],
      },
      {
        subtitle: "Asociar a orden de servicio",
        body: "Podés vincular un remito a una orden de servicio para mantener la trazabilidad completa: desde la recepción del equipo hasta el cobro.",
        seeAlso: ["ordenes", "caja"],
      },
    ],
  },
  {
    id: "caja",
    title: "Caja",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Cómo funciona la Caja",
        body: "El módulo de Caja unifica en una sola vista todos los movimientos de dinero del día: cobros de órdenes, ventas del POS, pagos de remitos, depósitos a cuenta corriente y movimientos manuales (ingresos y egresos). Cada movimiento queda registrado con su método de pago (Efectivo, Transferencia, Tarjeta Débito, Tarjeta Crédito, MercadoPago, Cuenta Corriente u Otro). Podés navegar día por día con las flechas y usar el botón \"Hoy\" para volver al día actual.",
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
        body: "Además de los cobros automáticos (órdenes, ventas, remitos), podés registrar movimientos manuales desde la pestaña \"Movimientos Manuales\". Sirven para asentar gastos del día (insumos, pago a proveedor, retiros) o ingresos extra que no provienen de una venta.",
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
    id: "finanzas",
    title: "Finanzas",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "La plata del período, no la del día",
        body: "La Caja te muestra el día; Finanzas te muestra el período. Elegís un rango de fechas y ves las cuatro vistas con el mismo filtro:",
        steps: [
          "Resumen: ingresos, gastos y resultado del período",
          "Estado de resultados: ingresos menos costo de mercadería es la ganancia bruta; menos los gastos, la ganancia neta",
          "Ingresos: de dónde vino la plata (órdenes, ventas, POS)",
          "Gastos: en qué se fue, agrupado por categoría",
        ],
        tip: "Mirá Finanzas una vez por mes con el mismo rango que el mes anterior. La comparación es la que te dice si mejoraste, no el número suelto.",
        seeAlso: ["caja", "reportes"],
      },
    ],
  },
  {
    id: "proveedores",
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
    id: "compras",
    title: "Compras",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Órdenes de compra a proveedores",
        body: "Las órdenes de compra formalizan lo que le pedís a cada proveedor y, sobre todo, hacen que la mercadería entre al inventario cuando llega, con su costo real, sin cargarla a mano.",
        steps: [
          "Andá a \"Compras\" y creá una nueva orden de compra",
          "Elegí el proveedor",
          "Agregá los items con cantidad y costo unitario",
          "Guardala como Borrador y, cuando se la mandes al proveedor, pasala a Enviada",
        ],
        seeAlso: ["proveedores", "inventario"],
      },
      {
        subtitle: "Recibir la mercadería",
        body: "Cuando llega el pedido, usá \"Recibir\" e indicá cuánto entró de cada item. Si vino todo, la orden queda Recibida; si vino una parte, queda Parcial y podés seguir recibiendo el resto más adelante. Cada recepción genera el movimiento de stock correspondiente.",
        steps: [
          "Borrador: la orden se está armando",
          "Enviada: ya se la pasaste al proveedor",
          "Parcial: llegó una parte del pedido",
          "Recibida: entró todo",
          "Cancelada: el pedido no se concretó",
        ],
        tip: "Recibí siempre por el sistema, aunque tengas la caja abierta en el mostrador: es lo que mantiene el stock y el costo de compra al día para los reportes de rentabilidad.",
        seeAlso: ["inventario", "reportes"],
      },
    ],
  },
  {
    id: "garantias",
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
        body: "Los reportes avanzados permiten análisis más detallados con filtros personalizados, cruces de datos y exportación a Excel y PDF: rentabilidad por período, rentabilidad por técnico y análisis de inventario.",
        roles: ["ADMIN"],
        seeAlso: ["finanzas", "comisiones"],
      },
      {
        subtitle: "Costos y márgenes: quién los ve",
        body: "Los reportes que muestran costo de mercadería, margen o rentabilidad son del administrador. El vendedor ve el movimiento de ventas — cuánto se vendió y de qué — pero no lo que cada producto costó ni el margen que dejó, salvo que se le haya habilitado el acceso a inventario.",
        tip: "Es la misma regla en todo el sistema: el precio de compra viaja con el permiso de inventario, no con la sección donde aparece.",
        roles: ["ADMIN"],
        seeAlso: ["configuracion", "inventario"],
      },
      {
        subtitle: "Exportación de datos",
        body: "Todos los reportes se pueden exportar en formato Excel o PDF para compartir con socios, contadores o para tu archivo.",
      },
    ],
  },
  {
    id: "emails",
    title: "Emails",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Gestión de emails",
        body: "Desde esta sección podés ver el historial de emails enviados desde STApp: notificaciones de órdenes, cotizaciones enviadas, remitos y comunicaciones con clientes.",
      },
      {
        subtitle: "Plantillas de email",
        body: "STApp usa plantillas profesionales para cada tipo de comunicación. Los emails incluyen automáticamente el logo y datos de tu taller.",
      },
    ],
  },
  {
    id: "leads",
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
    id: "asistente",
    title: "Asistente del panel",
    roles: ["ADMIN", "TECNICO", "VENDEDOR"],
    content: [
      {
        subtitle: "Preguntale al asistente",
        body: "Dentro del panel hay un asistente que responde dudas de uso: cómo hacer algo, dónde está una función, qué significa un estado. Contesta en base a este mismo manual y te deja el enlace a la sección correspondiente.",
        tip: "El asistente explica cómo usar STApp; no toca tus datos ni hace cambios por vos.",
        seeAlso: ["soporte"],
      },
      {
        subtitle: "Disponibilidad",
        body: "Está incluido en el plan Profesional. En el plan Free el ícono aparece bloqueado, con el enlace para ver los planes.",
        seeAlso: ["suscripcion"],
      },
    ],
  },
  {
    id: "soporte",
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
    title: "Configuración",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Datos de la empresa",
        body: "En Configuración > General podés editar los datos de tu organización: nombre, dirección, teléfono, email y logo. Estos datos aparecen en todas las comunicaciones y documentos generados (órdenes, remitos, cotizaciones).",
      },
      {
        subtitle: "Datos fiscales y de cobro",
        body: "Cargá una sola vez tus datos fiscales (CUIT, condición frente al IVA, domicilio fiscal, ingresos brutos e inicio de actividades) y tus datos de cobro (CBU o alias, medios de pago que aceptás y plazo de pago). Aparecen impresos en los remitos y comprobantes.",
        seeAlso: ["facturacion"],
      },
      {
        subtitle: "Facturación / IVA",
        body: "Definí tu régimen de IVA y la alícuota que usás por defecto en presupuestos y comprobantes. También podés activar el redondeo en efectivo para evitar los centavos imposibles de dar de vuelto.",
        seeAlso: ["cotizaciones", "pos"],
      },
      {
        subtitle: "Módulos opcionales",
        body: "Tres interruptores que cambian qué ve tu equipo y cómo se liquida el trabajo:",
        steps: [
          "Agenda de turnos: agrega la sección Agenda al menú",
          "Los vendedores pueden administrar inventario: les habilita la sección Inventario (y con ella, el precio de compra)",
          "Pagar comisión en órdenes sin reparación: incluye en la liquidación los equipos entregados sin reparar",
        ],
        seeAlso: ["agenda", "inventario", "comisiones"],
      },
      {
        subtitle: "Vocabulario del rubro",
        body: "STApp no es solo para talleres de celulares. Desde Configuración > Vocabulario cambiás los términos que usa el sistema para que hablen tu idioma: \"equipo\" puede ser vehículo, prenda, bicicleta o lo que trabajes. Los textos de la app, los comprobantes y los mensajes se adaptan.",
        tip: "Ajustar el vocabulario antes de capacitar al equipo evita la confusión de traducir mentalmente cada pantalla.",
      },
      {
        subtitle: "Sucursales y depósitos",
        body: "Si tenés más de un local, dalos de alta en Configuración > Sucursales: cada uno lleva sus órdenes, sus ventas y su personal por separado. Los depósitos (Configuración > Depósitos) son distintos: separan dónde está guardado el stock, no la operación.",
        tip: "Una sucursal solo se puede archivar si no tiene órdenes ni personal asignado; un depósito, solo si no tiene stock. Si todavía los tienen, desactivalos en lugar de archivarlos.",
        seeAlso: ["inventario"],
      },
      {
        subtitle: "Recargos por método de pago",
        body: "Definí un porcentaje por cada método de pago (efectivo, transferencia, débito, crédito, MercadoPago). El POS y las ventas aplican el ajuste solo cuando elegís el método, sin que tengas que recalcular a mano.",
        seeAlso: ["pos", "ventas"],
      },
      {
        subtitle: "Etiquetas térmicas",
        body: "Desde Configuración > Etiquetas térmicas definís cómo salen las etiquetas de los equipos y de los productos: tamaño de papel y qué datos se imprimen.",
        seeAlso: ["ordenes", "inventario"],
      },
      {
        subtitle: "Comprobantes y términos",
        body: "Los textos legales que se imprimen los editás vos: términos de la recepción (lo que el cliente acepta al dejar el equipo), términos de las cotizaciones y del comprobante, días de garantía por defecto, porcentaje de anticipo sugerido y política de abandono de equipos.",
        tip: "La política de abandono impresa en el comprobante de recepción es tu respaldo cuando un equipo lleva meses sin que lo retiren.",
        seeAlso: ["ordenes", "cotizaciones", "facturacion"],
      },
      {
        subtitle: "API keys y webhooks",
        body: "Si querés conectar STApp con otro sistema, podés generar claves de API y configurar webhooks para que te avisen cuando pasan cosas (por ejemplo, una orden que cambia de estado). Es una función para integraciones, no hace falta tocarla para el uso diario.",
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
        body: "Configurá la conexión de WhatsApp para enviar notificaciones a tus clientes cuando cambie el estado de una orden. Si trabajás con más de una sucursal, cada una puede tener su propio número.",
        steps: [
          "Andá a Configuración > WhatsApp",
          "Seguí las instrucciones para vincular tu número",
          "Elegí qué avisos automáticos querés activar",
        ],
        seeAlso: ["ordenes", "clientes"],
      },
      {
        subtitle: "Plantillas de mensajes",
        body: "En Configuración > Plantillas de WhatsApp editás el texto de cada mensaje: equipo listo para retirar, presupuesto enviado, recordatorio de cobro, aviso de turno y varios más. Cada plantilla tiene variables que STApp completa sola (nombre del cliente, número de orden, saldo, link de seguimiento).",
        tip: "Escribí los mensajes como los dirías vos. El cliente nota la diferencia entre un aviso escrito por el negocio y un texto genérico de sistema.",
        seeAlso: ["clientes", "agenda"],
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
        body: "Cobro a cuenta de un remito, venta u orden. El estado pasa a \"Pagado parcial\" hasta que la suma de los pagos cubra el total, momento en que pasa a \"Pagado\".",
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
        subtitle: "Servicio",
        body: "Trabajo que cobrás y que no consume stock: diagnóstico, instalación, mantenimiento, visita. Vive en la sección Servicios con su precio de lista y su duración estimada. A diferencia de un repuesto, se puede vender infinitas veces porque no hay unidades que se agoten.",
      },
      {
        subtitle: "Cliente mayorista",
        body: "Cliente marcado con un porcentaje de descuento propio. Cuando le cargás una venta, una orden o un presupuesto, STApp ya sugiere el precio con ese descuento aplicado, en vez de dejarte hacer la cuenta cada vez.",
      },
      {
        subtitle: "Talón del comprobante de recepción",
        body: "La parte de la hoja de recepción que se queda el taller, separada por una línea de corte. Ahí va el código de acceso del equipo; en la copia del cliente no aparece.",
      },
      {
        subtitle: "Depósito vs sucursal",
        body: "Depósito = dónde está guardada la mercadería (mostrador, taller, galpón). Sucursal = una operación completa aparte, con sus órdenes, sus ventas y su personal. Una sucursal puede tener varios depósitos.",
      },
      {
        subtitle: "Comisión",
        body: "Parte del trabajo que le queda al técnico o al vendedor. En órdenes se calcula sobre la ganancia (costo final menos repuestos) y solo se liquida cuando la orden está cobrada.",
      },
      {
        subtitle: "Recargo por método de pago",
        body: "Porcentaje que se suma al precio según cómo paga el cliente (por ejemplo, tarjeta de crédito). No es un cargo aparte: forma parte del precio de esa venta y los reportes lo cuentan como ingreso.",
      },
      {
        subtitle: "2FA (autenticación en dos pasos)",
        body: "Capa extra de seguridad para iniciar sesión: además de tu contraseña, te pide un código que se genera en una app de tu celular (Google Authenticator, Authy, etc.). Hace mucho más difícil que alguien acceda a tu cuenta aunque sepa tu contraseña.",
      },
    ],
  },
  {
    id: "suscripcion",
    title: "Suscripción y pagos",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Período de prueba",
        body: "Al registrarte, tenés 30 días gratis con acceso completo a todas las funciones de STApp. No se requiere tarjeta de crédito para la prueba.",
      },
      {
        subtitle: "Planes disponibles",
        body: "Terminado el período de prueba, la cuenta queda en el plan Free: sigue siendo usable para lo básico, pero con límites de órdenes, clientes y usuarios, y sin las funciones avanzadas. El plan Profesional levanta esos límites y habilita WhatsApp, cotizaciones, POS, cuenta corriente, reportes avanzados, recepción de varios equipos, asistente del panel y exportación de datos. Podés pagarlo por mes o por año, con descuento en el anual.",
        tip: "En Configuración > Billing ves siempre qué plan tenés activo, cuánto te queda de prueba y qué límite estás por alcanzar.",
        seeAlso: ["configuracion"],
      },
      {
        subtitle: "Métodos de pago",
        body: "Podés pagar en pesos con MercadoPago (tarjetas, débito, efectivo y demás medios disponibles en Argentina) o en dólares con tarjeta internacional. Elegís el medio al momento de contratar el plan.",
      },
      {
        subtitle: "Si un pago falla",
        body: "Cuando un cobro no sale, STApp no te corta el acceso de golpe: te avisa por email y reintenta durante unos días para que puedas actualizar la tarjeta. Recién si el problema no se resuelve, la cuenta baja al plan Free — tus datos siguen ahí.",
        tip: "Las tarjetas vencen y los bancos rechazan cobros por motivos tontos. Si te llega el aviso, actualizá el medio de pago desde Configuración > Billing y listo.",
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
