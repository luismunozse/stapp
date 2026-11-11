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
        body: "Entrá a stapp.com.ar y tocá \"Probar gratis\". El registro es una sola pantalla en dos partes: primero tu negocio (nombre, tu dirección nombre.stapp.com.ar y qué reparás) y después tu cuenta, con Google o con email y contraseña. Tenés 30 días gratis, sin tarjeta.",
        steps: [
          "En \"Tu negocio\" escribí el nombre: la dirección (\"Tu URL\") se arma sola y la podés editar. Tiene que decir \"Disponible\"",
          "En \"¿Qué reparás?\" elegí tu rubro. Si elegís \"Otro servicio técnico\", contá qué reparás",
          "En \"Tu cuenta\" tocá \"Registrarse con Google\", o completá tu nombre, email y contraseña (mínimo 8 caracteres) y tocá \"Crear cuenta gratis\"",
          "Si te registraste con email, abrí el mail y tocá \"Verificar mi email\" (el enlace vence en 24 horas). Con Google no hace falta verificar",
          "Iniciá sesión en tu dirección y seguí el asistente de bienvenida",
        ],
        tip: "¿No te llegó el mail de verificación? Revisá spam o tocá \"Reenviar email de verificación\". Sin verificar el email no se puede entrar.",
      },
      {
        subtitle: "Configuración inicial del taller",
        body: "La primera vez que entrás como administrador se abre el asistente de bienvenida: Tu negocio (nombre, logo y rubro), Primera orden y una práctica opcional en la que cargás una orden a tu nombre, la marcás como reparada y la entregás, para ver los avisos que recibe el cliente. Podés tocar \"Omitir y entrar al panel\" en cualquier momento. Después del asistente, te recomendamos:",
        steps: [
          "Completá los datos de tu empresa en Configuración > pestaña Empresa",
          "Subí el logo de tu taller (aparecerá en órdenes, presupuestos, remitos y etiquetas)",
          "Agregá tus técnicos y vendedores desde las secciones correspondientes",
          "Cargá tu inventario de repuestos",
          "Revisá las plantillas de checklist de recepción",
          "Configurá la integración con WhatsApp si querés enviar notificaciones",
        ],
        tip: "La orden de práctica no suma a los límites del plan y se borra sola cuando cargás tu primera orden real. Si querés explorar con datos de ejemplo, usá \"Cargar datos de ejemplo\" en el checklist del panel (solo en cuentas nuevas).",
        roles: ["ADMIN"],
        seeAlso: ["configuracion", "inventario", "tecnicos"],
      },
      {
        subtitle: "Rubro de tu negocio",
        body: "El rubro que elegís al registrarte prepara tus tipos de equipo, el checklist de recepción y el vocabulario del sistema. Los rubros son: Electrónica y computación; Electrodomésticos y refrigeración; Taller mecánico / Automotor; Motos y bicicleterías; Relojería y joyería; y Otro servicio técnico (donde contás qué reparás).",
        tip: "Podés cambiar el rubro desde el asistente de bienvenida (\"Tu rubro · Cambiar\") mientras no hayas cargado órdenes reales; si hiciste la práctica, se borra. Después podés ajustar todo a mano en Tipos de dispositivo, Checklist y Configuración > Vocabulario.",
        roles: ["ADMIN"],
        seeAlso: ["configuracion"],
      },
      {
        subtitle: "Roles y permisos",
        body: "STApp maneja tres roles con distintos niveles de acceso. El Administrador tiene acceso completo a todas las funciones. El Técnico puede gestionar órdenes asignadas, ver clientes y cotizaciones. El Vendedor puede gestionar ventas, clientes, POS y proveedores.",
        steps: [
          "Administrador (ADMIN): acceso total — órdenes, inventario, comprobantes, reportes, configuración, técnicos, vendedores, caja y más",
          "Técnico (TECNICO): órdenes asignadas, clientes, cotizaciones y dashboard",
          "Vendedor (VENDEDOR): ventas, POS, clientes (puede crearlos y editarlos, pero no eliminarlos), proveedores, reportes de ventas y dashboard",
        ],
        tip: "Solo los administradores pueden agregar o modificar usuarios y cambiar la configuración del sistema. Algunos permisos extra de técnicos y vendedores (por ejemplo tomar órdenes sin asignar, o abrir y cerrar la caja) se activan en Configuración > Secciones > Roles y permisos.",
      },
      {
        subtitle: "Técnicos que toman órdenes sin asignar",
        body: "Por defecto solo el administrador asigna órdenes a los técnicos. Si el taller lo habilita en Configuración > Roles y permisos (\"Tomar órdenes sin asignar\"), los técnicos también ven las órdenes que todavía no tienen técnico y pueden tomarlas para sí mismos, por ejemplo cuando no hay un administrador presente.",
        steps: [
          "El técnico ve las órdenes sin asignar en el listado, marcadas como \"Sin asignar\"",
          "Al abrirlas o desde el listado, usa el botón \"Tomar orden\" para quedar asignado",
          "Solo puede tomarlas para sí mismo: no puede reasignar órdenes de otros técnicos ni asignar a otra persona",
          "El técnico solo ve las órdenes sin asignar de su sucursal",
          "Si dos técnicos intentan tomar la misma orden, se la queda el primero y el segundo recibe un aviso",
          "Una vez tomada, la orden es del técnico y rigen las reglas habituales",
        ],
        tip: "Las órdenes ya cerradas (entregadas, canceladas, sin reparación o sin falla detectada) no se pueden tomar.",
        roles: ["ADMIN", "TECNICO"],
      },
      {
        subtitle: "Navegación general",
        body: "STApp tiene una barra lateral (sidebar) en escritorio y un menú inferior en dispositivos móviles. La barra lateral se puede colapsar para ganar espacio. En móvil, los 4 accesos principales están en la barra inferior y el resto en el menú \"Más\".",
      },
      {
        subtitle: "Iniciar sesión",
        body: "Cada negocio entra por su propia dirección (por ejemplo mitaller.stapp.com.ar). Podés iniciar sesión con email y contraseña o con \"Continuar con Google\". Si marcás \"Recordarme por 30 días\" no te pide los datos cada vez. Si te olvidaste la contraseña, tocá \"¿Olvidaste tu contraseña?\" y te mandamos un enlace por email.",
        tip: "Cada dispositivo tiene su propia sesión: cerrar sesión en uno no cierra los demás. Si cambiás la contraseña, se cierran todas las sesiones en menos de una hora.",
      },
      {
        subtitle: "Autenticación en dos pasos (2FA)",
        body: "Para mayor seguridad, podés activar la verificación en dos pasos desde tu perfil. Al habilitarla, cada vez que inicies sesión se te pedirá un código adicional, también si entrás con Google.",
        steps: [
          "Andá a Perfil > pestaña Seguridad y tocá \"Activar 2FA\"",
          "Escaneá el código QR con Google Authenticator, Authy o una app similar",
          "Ingresá el código de 6 dígitos que muestra la app",
          "Guardá los códigos de respaldo (podés copiarlos con \"Copiar codigos\")",
        ],
        tip: "Si no tenés el celular a mano al iniciar sesión, tocá \"Usar codigo de respaldo\". Guardá esos códigos en un lugar seguro.",
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
      {
        subtitle: "Campanita de avisos",
        body: "La campanita del encabezado muestra los avisos no leídos (stock bajo, solicitudes del catálogo, novedades de órdenes, etc.). Se actualiza sola cada pocos segundos, con un aviso y un sonido cuando entra uno nuevo. Podés marcarlos como leídos de a uno o todos juntos.",
        tip: "Los mismos avisos te pueden llegar como notificación push al celular o la computadora (ver App móvil > Notificaciones push).",
        seeAlso: ["app-movil"],
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
        body: "Las órdenes de servicio son el corazón de STApp. Para crear una nueva orden, andá a la sección \"Órdenes\" y hacé clic en \"Nueva\".",
        steps: [
          "Seleccioná o creá un cliente (podés buscarlo por nombre, teléfono o DNI)",
          "Completá los datos del equipo: tipo de dispositivo, marca, modelo y número de serie",
          "Describí el problema reportado por el cliente",
          "Asigná un técnico responsable (solo aparecen los técnicos de la sucursal de la orden)",
          "Opcionalmente: establecé una fecha estimada de entrega, definí un presupuesto y completá el checklist de recepción y la firma del cliente",
          "Hacé clic en \"Crear Orden\" — se asignará un número automático",
        ],
        tip: "Podés tomar fotos del equipo al momento de la recepción para documentar el estado inicial. Esto es útil ante reclamos.",
        seeAlso: ["clientes", "configuracion"],
      },
      {
        subtitle: "Estados de una orden",
        body: "Cada orden pasa por distintos estados que reflejan el progreso de la reparación:",
        steps: [
          "Recibido: la orden fue creada y el equipo está en el taller",
          "En Diagnóstico: el técnico está revisando el equipo",
          "Presupuestado: se cargó un presupuesto y espera la respuesta del cliente",
          "Aprobado: el cliente aprobó el presupuesto",
          "En Reparación: el técnico está trabajando en el equipo",
          "Esperando Repuesto: se necesita un repuesto que no está en stock",
          "Reparado: la reparación terminó y el equipo está listo para retirar",
          "Entregado: el cliente retiró su equipo",
          "Entregado sin Cobro: se entregó sin cobrar (por ejemplo, quedó en cuenta corriente)",
          "Sin Reparación: el equipo no se pudo o no se quiso reparar",
          "Retirado sin Reparación: el cliente retiró el equipo sin reparar",
          "Sin Falla Detectada: no se encontró la falla reportada",
          "Cancelado: la orden fue cancelada",
        ],
        tip: "Los estados de entrega se marcan con el botón de entrega, que registra la fecha, las firmas y el saldo pendiente.",
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
        body: "Desde el detalle de la orden (o desde la ventana que aparece al crearla) usá \"PDF\" para verla o \"Imprimir\" para mandarla a la impresora. Al lado tenés un selector de tamaño de hoja (A4, A5 o A6) que cambia solo esa impresión. El tamaño por defecto del taller se elige en Configuración > pestaña Comprobantes > \"Tamaño de hoja para las órdenes\". En A4 la orden de ingreso trae un talón para el local. En A5 y A6 sale siempre en una sola hoja, y la orden de ingreso suma una segunda página, \"COPIA PARA EL LOCAL\", con el código de acceso del equipo (PIN o patrón). La copia del cliente nunca lleva el código. El PDF incluye el logo del taller y la firma de recepción.",
        tip: "Si una orden no entra en A5 o A6, el sistema achica la letra y recorta los textos largos con \"…\". Los totales nunca se recortan.",
        seeAlso: ["configuracion"],
      },
      {
        subtitle: "Editar la orden desde el detalle",
        body: "En el detalle de la orden podés corregir datos sin rehacerla: fecha prometida, datos del equipo, accesorios, observaciones y el teléfono al que se mandan los avisos.",
        steps: [
          "Fecha prometida: en la tarjeta de estado tocá el lápiz junto a \"Prometida\" (o \"Agregar\" si no tiene), elegí la fecha y tocá \"Guardar\". Con \"Quitar\" la borrás",
          "Equipo: tocá el lápiz junto al título del equipo para abrir \"Editar equipo\" (marca, modelo, color, serie/IMEI, código de acceso y los campos extra del rubro)",
          "\"Accesorios recibidos\" y \"Observaciones\" se editan en el lugar con el lápiz, igual que el diagnóstico",
          "\"Teléfono para avisos\" (sección Cliente): si lo dejás vacío se usa el teléfono del cliente",
        ],
        tip: "El tipo de equipo no se puede cambiar, porque define el código de la orden. Si el tipo pide IMEI, tiene que tener 15 dígitos. Un técnico solo puede editar las órdenes que tiene asignadas.",
        roles: ["ADMIN", "TECNICO", "VENDEDOR"],
      },
      {
        subtitle: "Etiqueta para el equipo",
        body: "Desde el detalle de la orden, el botón \"Etiqueta\" imprime una etiqueta térmica para pegar en el equipo. Lleva el logo del taller (o el nombre, si no hay logo), el código de la orden, el cliente, el teléfono, el IMEI o número de serie, el problema reportado y la fecha. No lleva QR: el cliente recibe el seguimiento por el comprobante y por WhatsApp. Cuando la orden está en Reparado aparece además \"Etiqueta Reparado\" (\"Listo para entregar\").",
        steps: [
          "Elegí el tamaño en el selector de al lado (etiqueta de 40×30, 50×30, 50×40 o 60×40 mm, o rollo de 58 u 80 mm). Se guarda para todo el taller",
          "Tocá \"Etiqueta\". También podés imprimirla desde la ventana que aparece al crear la orden",
        ],
        tip: "El teléfono y el IMEI se omiten si están vacíos. El problema se corta en 3 líneas en las etiquetas de 30 mm y en 5 en las de 40 mm.",
      },
      {
        subtitle: "Firma de recepción",
        body: "Si el tipo de equipo tiene un checklist configurado, el paso \"Fotos y Checklist\" de la nueva orden muestra el \"Checklist de Recepción\" con sus observaciones y el recuadro \"Firma del Cliente (Conformidad de recepción)\". La firma se guarda aunque no marques ningún ítem y sale impresa en el PDF de la orden.",
        tip: "Si no ves el recuadro de firma, configurá un checklist para ese tipo de equipo en Configuración > Checklist.",
        seeAlso: ["configuracion"],
      },
      {
        subtitle: "Cobrar una orden",
        body: "En el detalle, la tarjeta de costos tiene el botón \"Cobrar\" (\"Ver Cobros\" si ya está cobrada). También se puede cobrar desde el listado de órdenes y desde Clientes. Podés repartir el pago entre varios métodos.",
        steps: [
          "Administrador: puede cobrar siempre y aplicar descuentos",
          "Vendedor: puede cobrar si el taller activó \"Abrir y cerrar la caja\" en Configuración > Secciones > Roles y permisos. Solo cobra órdenes de su sucursal y no puede aplicar descuentos",
          "Técnico: no registra cobros de órdenes",
        ],
        tip: "Anular un cobro es solo para administradores.",
        roles: ["ADMIN", "VENDEDOR"],
        seeAlso: ["caja"],
      },
      {
        subtitle: "Recibir varios equipos y lotes mayoristas",
        body: "Con \"Recibir varios equipos\" (en el listado de órdenes) cargás todos los equipos de un cliente en una sola atención: se crea una orden por equipo y un lote que las agrupa. Desde \"Ver lote\" (al terminar) o \"Parte del lote …\" (en el detalle de cada orden) ves los equipos, el subtotal, el descuento, el \"Total del lote\", lo \"Ya cobrado\" y lo \"Pendiente de cobro\".",
        steps: [
          "Descuento del lote: elegí Porcentaje o Monto, cargá el valor y tocá \"Guardar\". Solo se puede mientras no se haya entregado ningún equipo",
          "Cuando todos los equipos pendientes estén en Reparado, tocá \"Entregar lote\"",
          "Confirmá el costo final de cada equipo, elegí el método de pago y tocá \"Confirmar entrega\": se cobra una sola vez con el descuento aplicado",
        ],
        tip: "Si un equipo se retira suelto, se cobra a precio completo; al entregar el lote se cobra solo la diferencia, así se respeta el total negociado. Si no ves \"Recibir varios equipos\", tu plan no incluye esta función.",
        roles: ["ADMIN"],
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
        body: "Podés crear clientes de dos formas: desde la sección \"Clientes\" con el botón \"Nuevo cliente\", o directamente al crear una orden de servicio o venta si el cliente no existe aún.",
        steps: [
          "Completá el nombre y el teléfono (obligatorio, mínimo 7 dígitos). El email es opcional",
          "El teléfono no se puede repetir dentro del taller: si usás uno que ya tiene otro cliente, vas a ver el aviso \"Ya existe un cliente con ese teléfono\"",
          "Opcionalmente agregá dirección, DNI, razón social y CUIT",
        ],
      },
      {
        subtitle: "Historial del cliente",
        body: "Desde la ficha de cada cliente podés ver todo su historial: órdenes de servicio, ventas realizadas, estado de cuenta corriente y garantías activas. Esto te permite dar un servicio personalizado.",
      },
      {
        subtitle: "Cuenta corriente",
        body: "STApp lleva el registro de saldos pendientes de cada cliente. En la ficha del cliente, arriba, vas a ver \"Debe\" (fiado más órdenes reparadas o entregadas sin cobrar) y \"A favor\" (el saldo positivo de su cuenta corriente). Si trabajás con varias sucursales, \"Debe\" aparece con la leyenda \"en esta sucursal\"; el saldo de cuenta corriente, en cambio, es uno solo para todo el taller. En \"Órdenes pendientes de cobro\" podés usar \"Cobrar todo\".",
        tip: "Desde la ficha del cliente también podés cargar varias reparaciones de una vez como deuda (ver \"Cargar reparaciones a cuenta corriente\").",
        roles: ["ADMIN", "VENDEDOR"],
        seeAlso: ["facturacion", "caja", "glosario"],
      },
      {
        subtitle: "Comunicación por WhatsApp",
        body: "Desde la ficha del cliente podés enviar un mensaje de WhatsApp directamente, abriendo una conversación con el número registrado.",
      },
      {
        subtitle: "Cargar reparaciones a cuenta corriente",
        body: "Para clientes recurrentes (por ejemplo, un comercio que te trae equipos toda la semana) podés cargar varias reparaciones ya hechas sin abrir una orden completa para cada una. Quedan como deuda en la cuenta corriente y no se cobra nada en el momento.",
        steps: [
          "En la ficha del cliente, en la tarjeta \"Cuenta corriente\", tocá \"Cargar reparaciones\"",
          "Por cada fila completá Equipo, Tipo, Trabajo realizado, Precio y, si querés, días de garantía, Marca e IMEI / N° de serie. Con \"Agregar reparación\" sumás filas",
          "Revisá el \"Total a cargar\" y el saldo resultante, y tocá \"Cargar a cuenta corriente\"",
        ],
        tip: "Cada reparación queda como una orden Entregada, con garantía y búsqueda por IMEI. Si te equivocaste, usá \"Revertir lote\" en la pantalla de confirmación. Se pueden cargar hasta 50 reparaciones por vez. Si no ves \"Cargar reparaciones\", tu plan no incluye esta función.",
        roles: ["ADMIN", "VENDEDOR"],
      },
      {
        subtitle: "Eliminar un cliente",
        body: "Solo un administrador puede eliminar clientes, y solo si no tienen historial. Si el cliente tiene órdenes, ventas, cotizaciones o cuenta corriente, vas a ver el aviso \"No se puede eliminar un cliente con historial\" y no se borra nada. A los demás roles no les aparece la opción \"Eliminar\".",
        roles: ["ADMIN"],
      },
      {
        subtitle: "Clientes desde el celular",
        body: "En el celular, cada tarjeta de cliente muestra \"Debe\" en rojo o \"A favor\", y botones directos: \"Llamar\", \"WhatsApp\" y \"Cobrar\". \"Cobrar\" aparece solo si el cliente debe y tenés permiso para cobrar. Tocá la tarjeta para abrir la ficha.",
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
        body: "Desde esta sección podés agregar y administrar a los técnicos de tu taller. Cada técnico tiene un perfil con sus datos y las órdenes que tiene asignadas.",
        steps: [
          "Hacé clic en \"Nuevo Técnico\"",
          "Completá Nombre, Teléfono / WhatsApp, Email y una Contraseña: es la que va a usar para ingresar, pasásela vos (no se manda ningún email)",
          "Opcional: \"% Comisión como técnico\", \"Comisión por recepción (%)\", \"Costo por hora\" y \"Fecha de ingreso\"",
          "Si tenés más de una sucursal, elegí la Sucursal",
        ],
      },
      {
        subtitle: "Asignación de órdenes",
        body: "Podés asignar órdenes a cada técnico al crearlas o reasignarlas después. Solo se pueden asignar técnicos de la sucursal de la orden; si una orden vieja tiene un técnico de otra sucursal, aparece como \"(nombre) · otra sucursal\". Asignan o cambian el técnico el administrador o un vendedor de la sucursal de la orden; un técnico no puede. Desde el detalle del técnico, el botón \"Reasignar órdenes\" pasa sus órdenes a otro técnico.",
        seeAlso: ["ordenes"],
      },
      {
        subtitle: "Métricas de rendimiento",
        body: "Visualizá la productividad de cada técnico: cantidad de órdenes completadas, tiempo promedio de reparación y distribución de estados de sus órdenes.",
      },
      {
        subtitle: "Mover de sucursal",
        body: "Si un técnico o vendedor pasa a trabajar en otra sucursal, lo movés desde su formulario de edición. La opción aparece solo para administradores y solo si hay otra sucursal activa.",
        steps: [
          "Abrí el técnico o vendedor y tocá \"Editar\"",
          "En el bloque \"Sucursal\" tocá \"Mover de sucursal\"",
          "Revisá los avisos: si tiene órdenes abiertas o turnos pendientes, siguen asignados a esa persona, pero va a dejar de verlos hasta que vuelva a esa sucursal",
          "Elegí la \"Nueva sucursal\" y tocá \"Confirmar movimiento\"",
        ],
        tip: "Si tiene una caja abierta no se puede mover: hay que cerrarla antes. Mover a alguien no cambia de sucursal ninguna orden. El cambio se aplica en unos segundos, sin que tenga que volver a iniciar sesión.",
        roles: ["ADMIN"],
        seeAlso: ["vendedores"],
      },
      {
        subtitle: "Eliminar o dar de baja",
        body: "Desde el detalle del técnico o vendedor, el botón \"Eliminar\" funciona así: si la persona no tiene historial, se borra; si tiene historial (órdenes, ventas, cobros o caja), queda dada de baja: pierde el acceso, deja de aparecer en las listas y en las asignaciones, y su historial se conserva. Al darla de baja se libera su email, así que podés volver a darla de alta con el mismo email.",
        tip: "No se puede eliminar un técnico con órdenes activas asignadas: reasignalas primero con \"Reasignar órdenes\". Si solo querés que deje de recibir trabajo por un tiempo, usá \"Desactivar\"; con \"Reactivar\" vuelve. Hacelo desde el detalle de la persona, no desde la lista.",
        roles: ["ADMIN"],
      },
      {
        subtitle: "Personal por sucursal",
        body: "Las listas de técnicos y vendedores muestran el personal de la sucursal elegida en el selector de sucursal del encabezado; con \"Todas las sucursales\" ves a todos. Un técnico ve las órdenes que tiene asignadas en cualquier sucursal y, si el taller lo permite, las sin asignar de su sucursal.",
        roles: ["ADMIN"],
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
        body: "Similar a la sección de técnicos, acá gestionás a tu equipo de ventas. Cada vendedor tiene acceso al POS, ventas, clientes y proveedores.",
        steps: [
          "Hacé clic en \"Nuevo Vendedor\"",
          "Completá Nombre, Email, Contraseña (la que va a usar para ingresar; no se manda ningún email) y Teléfono",
          "Opcional: \"Porcentaje de comisión (%)\" sobre cada venta y \"Comisión por recepción (%)\"",
          "Si tenés más de una sucursal, elegí la Sucursal",
        ],
        tip: "Para moverlo de sucursal o darlo de baja, mirá \"Mover de sucursal\" y \"Eliminar o dar de baja\" en la sección Técnicos: funciona igual.",
        seeAlso: ["tecnicos", "comisiones"],
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
        subtitle: "Cómo funcionan las comisiones",
        body: "STApp calcula tres tipos de comisión: la del técnico, sobre cada reparación; la de recepción, para quien recibió el equipo; y la del vendedor, sobre cada venta. El porcentaje de cada persona se carga en su formulario (\"% Comisión como técnico\" o \"Porcentaje de comisión (%)\", y \"Comisión por recepción (%)\"). Si dejás vacío el de recepción, se usa el del taller. Cada orden guarda el porcentaje vigente al recibir el equipo.",
      },
      {
        subtitle: "Reglas de comisiones",
        body: "En Configuración > pestaña \"Comisiones\" definís las reglas de las reparaciones. Un cambio recalcula las comisiones pendientes; las ya pagadas no cambian.",
        steps: [
          "\"Cuándo se genera la comisión\": al entregar la orden y tenerla cobrada por completo, al entregar la orden, o al tener la orden cobrada por completo",
          "\"Base del técnico\" y \"Base de recepción\": Mano de obra (monto de la orden menos repuestos) o Monto de la orden (costo final menos descuentos y notas de crédito, sin el recargo de tarjeta)",
          "\"Porcentaje de recepción por defecto\": con 0, la recepción no genera comisión",
          "Opciones: \"Los reingresos por garantía generan comisión\" y \"Las órdenes entregadas sin reparar generan comisión\"",
          "Tocá \"Guardar reglas\"",
        ],
        tip: "Con una regla que pide cobro completo, las reparaciones fiadas no generan comisión hasta que se cobran del todo.",
      },
      {
        subtitle: "Pagar comisiones",
        body: "En el menú Más > \"Comisiones\" tenés las pestañas Técnicos, Recepción y Vendedores, con filtro por persona y fechas Desde/Hasta.",
        steps: [
          "Marcá las comisiones pendientes, o usá \"Seleccionar todas las pendientes\"",
          "Tocá \"Marcar como pagadas\" y confirmá",
          "Solo podés pagar juntas comisiones de una misma persona",
        ],
        tip: "Si el total es negativo (por devoluciones o notas de crédito), se registra como descuento a favor del taller. A un vendedor también lo podés liquidar desde su detalle con \"Liquidar\". El detalle del técnico lista sus comisiones y las exporta con el botón \"CSV\".",
      },
      {
        subtitle: "Anular un pago de comisiones",
        body: "Si pagaste por error, tocá la etiqueta \"Pagada\" de cualquier comisión de ese pago. Se abre \"Anular pago\" con cuántas comisiones incluye, el total y la fecha. Escribí el motivo (obligatorio) y confirmá: todas las comisiones del pago vuelven a quedar pendientes, y las de órdenes vuelven con el monto actual.",
      },
      {
        subtitle: "Comisión dentro de la orden",
        body: "En el detalle de la orden, el administrador ve la tarjeta \"Comisiones\" con la fila del técnico y la de recepción, cada una con su base y su porcentaje editable, más las \"Horas trabajadas\". Solo el administrador ve y edita estos campos.",
        seeAlso: ["ordenes", "configuracion"],
      },
    ],
  },
  {
    id: "inventario",
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
          "Si tenés 2 o más depósitos activos, elegí el \"Depósito del stock inicial\" (se habilita cuando el stock es mayor a 0; por defecto se usa el principal)",
          "Opcionalmente asigná un proveedor",
        ],
        tip: "Cuando cargás stock sin elegir depósito (en la lista, en la importación, o con lotes, series y kits), va al depósito principal de tu sucursal. Si sos administrador y estás en \"Todas las sucursales\", va al principal del taller.",
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
        subtitle: "Imprimir etiquetas",
        body: "Desde el menú de acciones de un item elegí \"Imprimir etiqueta\", o seleccioná varios items en la lista y usá el botón \"Etiquetas\" de la barra superior para imprimirlas juntas. En \"Medio de impresión\" elegís impresora térmica (etiqueta adhesiva) u hoja A4 con varias etiquetas, y en \"Tamaño de etiqueta\" uno de 40×25, 38×25, 40×30, 50×30, 50×40 o 60×40 mm, o rollo de 58 y 80 mm (etiquetas de 30 y 40 mm de alto). Cada etiqueta puede llevar nombre, código de barras, código y precio. Si un producto no tiene código, se imprime como etiqueta de precio (nombre y precio, sin código de barras). El medio y el tamaño se guardan para todo el taller: se configuran una vez y valen en todas las computadoras.",
        tip: "En el driver de la impresora configurá el mismo tamaño de etiqueta y los márgenes en 0. Las plantillas Zebra (ZPL/EPL) requieren que el producto tenga código.",
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
    id: "variantes",
    title: "Variantes de producto",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Qué son las variantes",
        body: "Una variante es una versión de un mismo producto: la funda en rojo y en azul, el cargador de 20 W y de 65 W. Cada variante tiene su propio código, su precio, su stock, su código de barras y su foto, y se vende y se descuenta por separado. Lo que es común al producto (categoría, tipo, proveedor, garantía, descripción y seguimiento de series o lotes) se mantiene igual en todas.",
      },
      {
        subtitle: "Crear un producto con variantes",
        body: "Desde \"Inventario\" > \"Nuevo Item\":",
        steps: [
          "Completá el nombre del producto, la categoría y el tipo",
          "Prendé \"Este producto tiene variantes\"",
          "Agregá una opción (por ejemplo Color) y sus valores (Rojo, Azul)",
          "Para cada variante revisá el código, el precio y el stock inicial",
          "Elegí una foto para cada variante, si querés",
          "Guardá: se crea un producto por cada combinación, con el nombre armado (por ejemplo \"Funda X - Rojo\")",
        ],
        tip: "El precio y el costo base se aplican a las variantes que todavía no tocaste. Si una variante tiene otro precio, escribilo en su fila y no se pisa.",
      },
      {
        subtitle: "Fotos por variante",
        body: "Cada variante tiene su propia foto, que se sube desde su fila. Si una variante no tiene foto, en la lista de inventario y en el formulario se muestra la foto de otra variante del mismo producto, atenuada y con la leyenda \"Foto de Rojo\" (por ejemplo), para que no la confundas con una propia. Esa foto prestada no se copia: en cuanto subas la de la variante, deja de usarse. Quitar la foto de una variante no toca las de las demás.",
      },
      {
        subtitle: "Agrupar productos que ya tenés",
        body: "Si ya cargaste varios productos sueltos que en realidad son versiones de uno, podés agruparlos sin perder nada:",
        steps: [
          "En la lista de inventario (vista de lista) seleccioná dos o más productos",
          "Tocá \"Agrupar productos existentes como variantes\"",
          "Definí las opciones y asigná a cada producto su variante",
          "Elegí si querés \"Renombrar productos\": vas a ver cómo queda cada nombre antes de confirmar",
          "Si los productos tienen datos distintos (por ejemplo la categoría), elegí de cuál se toman",
          "Confirmá",
        ],
        tip: "Cada producto conserva su código, su stock, sus precios, su historial y su foto. Si dejás \"Renombrar productos\" sin marcar, los nombres quedan como están. Todos toman los datos del producto que elijas, incluido el control de series y de lotes: si eso cambia algo para alguno, el diálogo te avisa. Si un producto deja de controlar series o empieza a pedir series al vender, tenés que marcar \"Entiendo\" para seguir; lo mismo si deja de controlar lotes, porque ya no vas a ver sus lotes y los avisos de vencimiento. Las series y los lotes ya cargados no se borran.",
      },
      {
        subtitle: "Agrupar desde el formulario (también en el celular)",
        body: "En el celular la lista no permite seleccionar varios productos. Para agrupar desde ahí, abrí el formulario de un producto y, con \"Este producto tiene variantes\" apagado, tocá \"Sumar productos existentes\": buscá, marcá dos o más productos y seguí con los mismos pasos de arriba. Si en el formulario tenés datos sin guardar, te preguntamos antes de seguir, porque esos datos no se guardan.",
      },
      {
        subtitle: "Cambiar o archivar variantes",
        body: "Abrí cualquiera de las variantes y vas a ver todo el producto. Podés agregar valores, cambiar precios o códigos y quitar una variante: si tiene stock te avisamos cuántas unidades quedan, y se archiva sin perder su historial. Una variante con unidades reservadas no se puede archivar.",
        seeAlso: ["inventario"],
      },
      {
        subtitle: "Desagrupar",
        body: "Si apagás \"Este producto tiene variantes\" en un producto ya guardado, te pedimos confirmación y se desagrupa: cada variante sigue existiendo como producto común, con su nombre, su stock, su precio y su foto. No se archiva ni se borra nada.",
      },
      {
        subtitle: "Variantes en el punto de venta",
        body: "En el POS, los productos con variantes aparecen en una sola tarjeta. Al tocarla se abre una hoja para elegir la variante a vender, con su stock. Si preferís verlas por separado, desactivá \"Agrupar variantes en el punto de venta\" en Configuración > pestaña Empresa > Módulos opcionales.",
        seeAlso: ["pos"],
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
        body: "Si una venta se cargó por error, podés anularla: cambia su estado a \"Anulada\". Para devolver productos o plata de una venta que sí ocurrió, usá una nota de crédito. Si la venta tiene una factura electrónica emitida, primero tenés que anularla con \"Anular factura\" en el bloque Factura electrónica. Tampoco se anula si tiene un remito vigente.",
        roles: ["ADMIN"],
        seeAlso: ["notas-credito", "facturacion-electronica"],
      },
    ],
  },
  {
    id: "notas-credito",
    title: "Notas de crédito",
    roles: ["ADMIN", "TECNICO", "VENDEDOR"],
    content: [
      {
        subtitle: "Qué es una nota de crédito",
        body: "Una nota de crédito deja constancia de lo que le devolvés o le acreditás a un cliente sobre una venta o una orden: productos que vuelven, un trabajo que no se hizo, un ajuste de precio. Cada una lleva su número NC- (las devoluciones registradas antes conservan su número DEV-). Es un comprobante interno: no reemplaza una factura ni una nota de crédito fiscal. La nota de crédito electrónica de ARCA se emite aparte, al anular la factura desde la venta.",
        tip: "Si el cliente todavía debía parte de la venta o de la orden, la nota de crédito primero baja esa deuda y solo el resto se le devuelve.",
      },
      {
        subtitle: "Emitir una nota de crédito",
        body: "Se emite siempre desde la operación que corrige.",
        steps: [
          "Desde una venta: abrí la venta y tocá \"Devolución\". Elegí los productos y las cantidades que vuelven y cómo le devolvés la plata",
          "Desde el POS: tocá \"Devolución\" y buscá la venta",
          "Desde una orden: en el detalle de la orden, abrí el menú de acciones y elegí \"Emitir nota de crédito\" (aparece cuando la orden tiene cobros)",
        ],
        roles: ["ADMIN"],
        seeAlso: ["ventas", "pos", "ordenes"],
      },
      {
        subtitle: "Encontrar una nota de crédito",
        body: "En Notas de crédito (/notas-credito, menú Finanzas) están todas las del taller, de ventas y de órdenes, incluidas las anuladas y las devoluciones anteriores. Podés buscar por número y filtrar por fecha, origen, tipo, motivo y estado. Cada fila te lleva a su venta u orden. Desde la ficha de un cliente, el botón \"Notas de crédito\" te muestra solo las suyas.",
        roles: ["ADMIN"],
        seeAlso: ["clientes"],
      },
      {
        subtitle: "Imprimir o enviar una nota de crédito",
        body: "En el detalle de la venta o de la orden, el bloque \"Notas de crédito\" muestra las que tiene, con tres botones: PDF (hoja A4), Ticket (impresora térmica de 58 u 80 mm, por USB o desde el navegador) y WhatsApp. WhatsApp comparte el PDF con un mensaje; el administrador puede cambiarlo en Configuración > Plantillas WhatsApp y los demás roles envían el texto estándar de STApp. En la compu, según el navegador se abre el menú de compartir del sistema o se descarga el PDF y se abre el chat del cliente para que lo adjuntes. El PDF muestra el saldo pendiente de la operación al día en que lo imprimís.",
        seeAlso: ["configuracion"],
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
        body: "El POS es una interfaz simplificada y rápida para registrar ventas en mostrador. Está diseñado para agilizar la atención al cliente con un flujo de cobro rápido.",
        steps: [
          "Abrí la sección \"POS\"",
          "Buscá y agregá productos al carrito (también con el lector de código de barras)",
          "Ajustá cantidades si es necesario",
          "Seleccioná el método de pago",
          "Tocá \"Cobrar Venta\" y confirmá. En efectivo podés cargar el \"Monto recibido\" — el stock se actualiza automáticamente",
        ],
      },
      {
        subtitle: "Pantalla de venta registrada",
        body: "Al cobrar se abre \"Venta registrada\". Si pagaron en efectivo y cargaste el monto recibido, se destaca el Vuelto con lo recibido y el total; si no, se destaca el Total. Desde ahí podés \"Imprimir\" (o \"Reimprimir\"), compartir el ticket, emitir la \"Factura\" electrónica (administradores con la facturación activada) y pasar a \"Nueva venta\" con el botón o con Enter.",
        seeAlso: ["facturacion-electronica"],
      },
      {
        subtitle: "Productos con variantes en el POS",
        body: "Los productos con variantes aparecen en una sola tarjeta. Al tocarla se abre una hoja con cada variante y su stock (\"Elegí la variante que vas a vender\"); las que no tienen stock figuran como \"Sin stock\". Si preferís verlas por separado, desactivá \"Agrupar variantes en el punto de venta\" en Configuración > pestaña Empresa > Módulos opcionales.",
        seeAlso: ["variantes"],
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
          "Elegí el porcentaje de IVA: el selector ofrece las alícuotas del país configurado en Configuración (Argentina 0%, 10.5%, 21% y 27%; Chile 0% y 19%; y así con cada país)",
          "Si trabajás con dólares, podés definir un tipo de cambio USD para mostrar el equivalente",
          "Opcionalmente agregá notas o condiciones",
          "Guardá como borrador o enviá directamente al cliente",
        ],
        tip: "El IVA en cotizaciones es configurable porque cada país, actividad y régimen fiscal usa una alícuota distinta. Si no discriminás IVA —por ejemplo, si sos monotributista en Argentina—, dejalo en 0%.",
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
        body: "El módulo de Comprobantes tiene dos pestañas: \"Remitos\" y, si emitís facturas electrónicas, \"Comprobantes ARCA\". Los remitos son documentos no fiscales (comprobantes internos para tu control), asociados a órdenes de servicio o independientes, y sus precios se cargan finales.",
        steps: [
          "Andá a \"Comprobantes\" y hacé clic en \"Generar remito\"",
          "Seleccioná el cliente",
          "Agregá los conceptos con descripción, cantidad y precio final",
          "Asigná un número de remito (manual)",
          "Guardá el remito",
        ],
        tip: "Para facturar ante ARCA activá la facturación electrónica en Configuración > pestaña Facturación (ver \"Facturación electrónica (ARCA)\"). El remito te sigue sirviendo para el control interno, los pagos parciales y la cuenta corriente.",
        seeAlso: ["facturacion-electronica"],
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
        subtitle: "Generación de PDF",
        body: "Podés descargar cada remito en formato PDF con el logo de tu taller, datos del cliente, detalle de conceptos y totales. Ideal para enviar por email o WhatsApp.",
      },
      {
        subtitle: "Asociar a orden de servicio",
        body: "Podés vincular un remito a una orden de servicio para mantener la trazabilidad completa: desde la recepción del equipo hasta el cobro.",
        seeAlso: ["ordenes", "caja"],
      },
    ],
  },
  {
    id: "facturacion-electronica",
    title: "Facturación electrónica (ARCA)",
    roles: ["ADMIN"],
    content: [
      {
        subtitle: "Requisitos y activación",
        body: "La factura electrónica está disponible para talleres de Argentina. Se activa en Configuración > pestaña Facturación, tarjeta \"Facturación electrónica (AFIP/ARCA)\", con la casilla \"Activar facturación electrónica\", que se guarda al tocarla. Las facturas salen a consumidor final: Factura C si sos Monotributo, Factura B si sos Responsable Inscripto. Por ahora se factura desde las ventas, no desde las órdenes.",
      },
      {
        subtitle: "Autorizar a STApp en ARCA (delegación)",
        body: "No necesitás certificados: delegás el servicio de facturación a STApp con tu Clave Fiscal.",
        steps: [
          "En ARCA entrá a Administrador de Relaciones de Clave Fiscal > Nueva Relación",
          "Servicio > Buscar > ARCA > WebServices > Facturación Electrónica",
          "En \"Representante\" pegá el CUIT de STApp que aparece en la tarjeta (sin guiones) y confirmá",
          "En STApp completá \"CUIT del taller\", \"Punto de venta\" y \"Condición fiscal\" y tocá \"Guardar\"",
          "Esperá a que STApp verifique que el CUIT es tuyo: mientras tanto figura \"Pendiente de verificación\" y no se puede facturar",
          "Tocá \"Probar conexión\"",
        ],
        tip: "El punto de venta tiene que estar creado en ARCA para Web Service (\"Factura Electronica - Monotributo - Web Service\" si sos Monotributo, \"RECE para aplicativo y Web Service\" si sos Responsable Inscripto); los de \"Factura en línea\" no sirven. ARCA puede tardar unas horas en reconocer la delegación: \"Probar conexión\" te indica a partir de qué hora volver a probar.",
      },
      {
        subtitle: "Emitir la factura de una venta",
        body: "En el detalle de la venta, el bloque \"Factura electrónica\" muestra \"Emitir factura electrónica\". Solo se puede emitir si la venta está completada, sin devoluciones y con total mayor a cero. Desde el POS, en la pantalla \"Venta registrada\", el botón \"Factura\" la emite al momento. Una vez emitida ves el número, el CAE, su vencimiento y el botón \"Ver PDF\"; el PDF trae el QR, el CAE y la leyenda de ARCA. Si ARCA la rechaza, ves el motivo y el botón \"Reintentar\".",
        seeAlso: ["ventas", "pos"],
      },
      {
        subtitle: "Factura pendiente de verificación",
        body: "Si la conexión con ARCA se corta durante el envío, la factura queda en proceso: ARCA puede haberla emitido igual. No la vuelvas a emitir: tocá \"Verificar con ARCA\" y STApp la confirma sin duplicarla. Lo mismo vale para una nota de crédito pendiente.",
      },
      {
        subtitle: "Anular una factura (nota de crédito electrónica)",
        body: "Anular una factura emite ante ARCA una nota de crédito electrónica por el total autorizado. No se puede deshacer y no toca el stock, la caja, la cuenta corriente ni el estado de la venta: si el cliente devolvió productos o plata, registrá la devolución aparte.",
        steps: [
          "En el detalle de la venta, bloque Factura electrónica, tocá \"Anular factura\"",
          "Elegí el motivo: \"Error en la factura\", \"Devolución total\" u \"Otro\" (en Otro, el detalle es obligatorio)",
          "Confirmá con \"Anular factura\" y no cierres la pantalla mientras se emite",
        ],
        tip: "La normativa pide emitir la nota de crédito dentro de los 15 días de la factura; pasado ese plazo te avisamos. Consultalo con tu contador.",
      },
      {
        subtitle: "Volver a facturar o editar una venta",
        body: "Con la factura anulada, el bloque ofrece \"Emitir factura nueva\" y la anterior queda en \"Facturas anteriores\". Mientras la venta tenga una factura emitida o en proceso no se puede editar ni anular; una vez anulada la factura con su nota de crédito, sí.",
      },
      {
        subtitle: "Listado de comprobantes ARCA",
        body: "En Comprobantes, pestaña \"Comprobantes ARCA\", ves todas las facturas y notas de crédito electrónicas con fecha, número, venta, total, estado, CAE y PDF. Podés filtrar por estado: Emitidas, En proceso, Rechazadas o Anuladas. La pestaña aparece si ya emitiste facturas o si hoy podés emitir.",
        seeAlso: ["facturacion"],
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
        body: "El resumen de caja muestra la tarjeta \"Órdenes Reparadas sin Cobrar\" con las órdenes reparadas o entregadas que todavía tienen saldo pendiente. Cada orden muestra el saldo pendiente y lo cobrado. No aparecen las que pasaron a cuenta corriente (fiado) ni las que tienen el remito pagado. Tocá una orden para ir a cobrarla.",
      },
      {
        subtitle: "Corregir el método de pago de un movimiento",
        body: "Si un cobro quedó con el método equivocado, en la pestaña Resumen, \"Detalle de Movimientos\", tocá el lápiz (\"Cambiar método de pago\"), elegí el método correcto y tocá \"Guardar\". Si pasás a tarjeta podés cargar el \"Costo de terminal (%)\"; si salís de tarjeta, se borran las cuotas, el recargo y el costo de terminal.",
        tip: "No se puede cambiar un pago a cuenta corriente, un movimiento de una sesión de caja ya cerrada, un movimiento anulado ni un cobro con cuotas ya cobradas.",
      },
      {
        subtitle: "Vendedores en la caja",
        body: "Por defecto la caja es del administrador. Si activás \"Abrir y cerrar la caja\" en Configuración > Secciones > Roles y permisos, los vendedores también pueden abrir y cerrar la caja y cobrar órdenes de su sucursal (sin aplicar descuentos).",
        roles: ["ADMIN"],
        seeAlso: ["ordenes"],
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
        body: "Configuración está organizada en pestañas: Secciones (accesos a Checklist, Roles y permisos, WhatsApp, Sucursales, Depósitos, Gastos, etc.), Empresa, Facturación, Comprobantes, Comisiones, Avisos y Seguridad. En la pestaña Empresa editás el logo, los datos de la empresa, el país, la moneda, la zona horaria y los módulos opcionales. Estos datos aparecen en todos los documentos (órdenes, remitos, cotizaciones). En Empresa, Facturación y Comprobantes los cambios se guardan con el botón \"Guardar Cambios\" de la barra fija de abajo.",
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
        body: "Personalizá los tipos de equipo que manejás en tu taller. Los tipos iniciales dependen del rubro que elegiste al registrarte (por ejemplo Celular y Computadora en electrónica, o Auto y Camioneta en automotor). Podés agregar o editar los que quieras.",
      },
      {
        subtitle: "Integración WhatsApp",
        body: "Configurá la integración con WhatsApp Business API para enviar notificaciones automáticas a tus clientes cuando cambie el estado de una orden.",
        steps: [
          "Andá a Configuración > Secciones > WhatsApp Business",
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
        body: "En Configuración > Secciones > Facturación y Plan podés ver tu plan actual, los días restantes de prueba, cambiar de plan y gestionar tu método de pago a través de MercadoPago.",
        seeAlso: ["suscripcion"],
      },
      {
        subtitle: "Roles y permisos",
        body: "En Configuración > Secciones > Roles y permisos activás permisos extra para técnicos y vendedores, por ejemplo que los técnicos tomen órdenes sin asignar o que los vendedores abran y cierren la caja.",
        seeAlso: ["primeros-pasos", "caja"],
      },
      {
        subtitle: "País, moneda e identificación fiscal",
        body: "En la pestaña Empresa elegís el país (Argentina, España y 18 países de Latinoamérica). Eso completa la moneda y la zona horaria por defecto, y define el formato de teléfono para WhatsApp, las alícuotas de IVA y el nombre del ID fiscal: CUIT en Argentina, NIF en España, RFC en México, etc.",
        tip: "La factura electrónica ARCA es solo para Argentina.",
      },
      {
        subtitle: "Sucursales",
        body: "En Configuración > Secciones > Sucursales creás las sucursales del taller con \"Nueva sucursal\": nombre y, opcionalmente, código, teléfono, dirección y notas. Una es la \"Principal\", que se usa por defecto. La cantidad de sucursales depende de tu plan; al llegar al límite vas a ver \"Límite de sucursales alcanzado\".",
        tip: "No podés desactivar ni archivar la principal: primero marcá otra como principal. Solo podés archivar una sucursal sin órdenes ni personal; si tiene, desactivala o mové antes a su personal.",
        seeAlso: ["tecnicos"],
      },
      {
        subtitle: "Depósitos",
        body: "En Configuración > Secciones > Depósitos administrás dónde está guardado el stock. Cada sucursal tiene su depósito principal, que es el que se usa cuando una operación no indica depósito; con varias sucursales, la etiqueta dice \"Principal · (sucursal)\". Solo se puede archivar un depósito sin stock; el historial de movimientos se conserva.",
        seeAlso: ["inventario"],
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
          "App Android: está en beta en Google Play. Anotate desde el aviso \"Sumate a la beta de Android\" del panel con el correo de Google de tu celular; cuando te agregamos, tocá \"Aceptar invitación\" e instalala desde Play Store",
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
      {
        subtitle: "Entrar a tu negocio desde la app",
        body: "Al abrir la app Android ingresás el identificador de tu negocio (lo que va antes de .stapp.com.ar) y tocás \"Continuar\". Los negocios que usaste quedan en \"Negocios recientes\". Para pasar a otro, tocá \"Cambiar de empresa\" en el login. Para crear un negocio nuevo, tocá \"Registrar mi negocio\".",
      },
      {
        subtitle: "Notificaciones push",
        body: "Cada aviso de la campanita también te llega como notificación al celular o la computadora, en aproximadamente un minuto. En la app Android se activan solas al iniciar sesión. En el navegador, andá a Perfil > Notificaciones push y tocá \"Activar\" (con \"Probar\" verificás que llegan).",
        tip: "Se activan por dispositivo. Si el navegador dice que el permiso está bloqueado, habilitalo en los ajustes del sitio y recargá la página.",
        seeAlso: ["dashboard"],
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
        body: "Tu cuenta está protegida con contraseña encriptada, verificación de email (automática si te registrás con Google) y la opción de activar autenticación en dos pasos (2FA), que también se pide al entrar con Google. Cada dispositivo tiene su propia sesión: cerrar sesión en uno no cierra los demás, y si cambiás la contraseña se cierran todas en menos de una hora.",
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
        body: "Indica si un trabajo terminado ya fue pagado: PENDIENTE (no se cobró nada), PARCIAL (se cobró algo pero falta saldo), COBRADO (cobrado en su totalidad).",
      },
      {
        subtitle: "Documento no fiscal",
        body: "Comprobante interno que emite STApp (remito, ticket, nota de crédito interna) para tu control y para entregarle al cliente. No tiene validez fiscal. En Argentina podés emitir además la factura electrónica ARCA de una venta.",
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
        body: "Para gestionar tu suscripción, andá a Configuración > Secciones > Facturación y Plan. Ahí podés ver tu plan actual, cambiar de plan, actualizar el método de pago y ver el historial de pagos.",
      },
    ],
  },
]
