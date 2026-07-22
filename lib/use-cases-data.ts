import {
  Smartphone,
  Monitor,
  Tv,
  Tablet,
  Gamepad2,
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
  // Resumen corto y de beneficio para las cards del índice de casos de uso.
  // Copy propio (no truncar heroDescription): sin cortes ni "...".
  cardDescription: string
  longIntro: string[]
  problems: string[]
  solutions: { title: string; description: string }[]
  workflow: { title: string; description: string }[]
  specificFeatures: { title: string; description: string }[]
  faqs: { question: string; answer: string }[]
  relatedSlugs: string[]
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
    cardDescription:
      "Órdenes, repuestos y avisos por WhatsApp para tu taller de celulares. Cada reparación bajo control, de la recepción a la entrega.",
    longIntro: [
      "Los talleres de reparación de celulares manejan un volumen alto de órdenes con tiempos cortos y márgenes ajustados. Un iPhone con pantalla rota a la mañana, un Samsung con batería inflada al mediodía, tres Motorola con problemas de carga por la tarde. Todo pasa rápido y cada equipo tiene un dueño impaciente esperando novedades. Sin un sistema, terminás anotando en una planilla, perdiéndote entre mensajes de WhatsApp y rogando que no se confunda un repuesto con otro.",
      "STApp fue pensado específicamente para esta realidad. Registrás el equipo en menos de un minuto, asignás técnico, seleccionás el tipo de falla desde una lista preconfigurada (pantalla, batería, conector de carga, módulo de cámara, daño por líquidos, problemas de software) y el cliente recibe automáticamente un link para seguir su reparación en tiempo real. Menos llamadas, menos fricciones, más equipos terminados por día.",
    ],
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
    workflow: [
      {
        title: "Recepción con fotos",
        description:
          "Fotografiás el equipo en 360° al ingresar, documentás golpes previos o rayones, y el cliente firma digitalmente la ficha de ingreso. Cumplís con Defensa del Consumidor y evitás discusiones al retirar.",
      },
      {
        title: "Diagnóstico y presupuesto",
        description:
          "Registrás la falla detectada, cargás los repuestos desde tu catálogo (pantallas, baterías, flex de carga) y enviás el presupuesto por WhatsApp en un click. El cliente aprueba o rechaza con firma digital.",
      },
      {
        title: "Aprobación y reparación",
        description:
          "Cuando el cliente aprueba, la orden pasa a 'en reparación' y el técnico asignado la ve en su panel. Si hace falta un repuesto pedido, queda en 'esperando repuesto' con ETA visible para el cliente.",
      },
      {
        title: "Control de calidad",
        description:
          "Antes de marcar como 'listo', foto del equipo reparado y test de funciones críticas: táctil, carga, señal, cámara, altavoz. Si algo falla, el estado vuelve para revisión interna.",
      },
      {
        title: "Entrega y garantía",
        description:
          "El cliente firma el retiro digitalmente y recibe por WhatsApp su factura y el comprobante de garantía con fecha de vencimiento. Si vuelve dentro del período cubierto, ya tenés todo documentado.",
      },
    ],
    specificFeatures: [
      {
        title: "Catálogo por marca y modelo",
        description:
          "Cargás una vez el catálogo de pantallas para iPhone 13, batería de Samsung A54, flex de carga de Xiaomi Redmi 12, y al abrir una orden solo seleccionás el modelo: el sistema descuenta el stock automáticamente.",
      },
      {
        title: "Reparaciones express y estándar",
        description:
          "Diferenciá tarifas y plazos entre reparaciones urgentes (mismo día) y estándar (48-72 hs). El precio se ajusta solo según el tipo de orden elegido al momento de presupuestar.",
      },
      {
        title: "Módulo de liberaciones y desbloqueos",
        description:
          "Registrá liberaciones de iCloud, eliminación de FRP de Samsung, recupero de patrones olvidados, como tipos de orden propios con sus estados, tarifas y tiempos estimados.",
      },
      {
        title: "Firma digital de recepción y retiro",
        description:
          "Evidencia legal del estado del equipo al ingresar y al entregar. Crítico ante un reclamo donde el cliente dice que el rayón no estaba, o que el equipo salió con más daños que los que tenía.",
      },
    ],
    faqs: [
      {
        question: "¿Puedo usar STApp si tengo un taller de celulares chico con un solo técnico?",
        answer:
          "Sí, el plan inicial está pensado para talleres de 1 a 2 personas. Podés cargar órdenes, llevar stock de los repuestos más comunes (pantallas, baterías, flex), enviar notificaciones por WhatsApp y hacer seguimiento, sin pagar funciones que no vas a usar. Cuando sumás técnicos, pasás al plan siguiente sin perder nada de lo que cargaste.",
      },
      {
        question: "¿Cómo funciona el seguimiento por WhatsApp para mis clientes?",
        answer:
          "Al cargar una orden, el cliente recibe un mensaje con un link único. En ese link ve el estado actualizado (recibido, en diagnóstico, esperando repuesto, listo), el presupuesto pendiente de aprobación y el detalle del trabajo. Las notificaciones se disparan en cada cambio de estado o podés enviarlas manualmente.",
      },
      {
        question: "¿Puedo cargar mi catálogo de repuestos actual al sistema?",
        answer:
          "Sí. Los cargás uno por uno desde el panel o importás desde una planilla Excel/CSV con nombre, marca, modelo compatible, costo y stock. Después el sistema te avisa cuando algún repuesto cae bajo el mínimo que vos definiste, así nunca más se te escapa un pedido de pantallas de iPhone.",
      },
      {
        question: "¿Qué pasa si el cliente viene a retirar y el equipo no está 100% listo?",
        answer:
          "Antes de eso ya recibió por WhatsApp la notificación de 'listo para retirar', así que no va a venir en blanco. Si igual pasa, en el panel del técnico ves el estado exacto, qué falta y podés avisarle en el momento cuánto más va a demorar, con evidencia visual del paso en que está.",
      },
      {
        question: "¿Sirve para manejar liberaciones y cuentas iCloud además de reparaciones físicas?",
        answer:
          "Sí. Creás tipos de orden distintos (reparación, liberación, desbloqueo, diagnóstico sin cargo) con sus propios estados, tarifas y tiempos estimados. Todo queda en el mismo historial del cliente, que puede ver tanto las reparaciones físicas como los trabajos de software.",
      },
    ],
    relatedSlugs: ["tablets", "computadoras"],
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
    cardDescription:
      "Diagnósticos documentados, presupuestos con opciones y garantías por componente para PCs, notebooks y laptops.",
    longIntro: [
      "Reparar computadoras no es lo mismo que reparar celulares. Un diagnóstico puede llevar horas: test de memoria, chequeo de disco con SMART, revisar temperaturas, armar un presupuesto con opciones (cambio de disco rígido por SSD vs. formateo vs. reemplazo de placa madre). El cliente muchas veces prefiere elegir entre alternativas, y vos necesitás que ese historial quede registrado para defender tu trabajo si algo falla meses después.",
      "STApp para servicio técnico de PC y notebooks te da checklists de diagnóstico reutilizables, presupuestos con múltiples alternativas que el cliente aprueba con firma digital, y control completo de garantías por componente. Si dentro de 6 meses vuelve con un disco que cambiaste, sabés al instante qué se instaló, cuándo y si está cubierto, sin revolver papeles ni planillas sueltas.",
    ],
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
          "Creá checklists personalizados para cada tipo de equipo. RAM, disco, placa madre, fuente: todo queda registrado en la orden.",
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
    workflow: [
      {
        title: "Ingreso con checklist",
        description:
          "Seleccionás el tipo de equipo (PC de escritorio, notebook, all-in-one) y el sistema te carga un checklist de revisión inicial: encendido, pantalla, teclado, puertos USB, red. Nada queda fuera porque el técnico olvidó mirarlo.",
      },
      {
        title: "Diagnóstico técnico documentado",
        description:
          "El técnico carga resultados de tests (memoria, disco con SMART, temperaturas de CPU y GPU) y detecta los componentes a reemplazar. Queda todo escrito para que el cliente sepa exactamente qué se revisó.",
      },
      {
        title: "Presupuesto con alternativas",
        description:
          "Armás 2 o 3 opciones de reparación (reparar vs. upgrade vs. equipo reacondicionado) con precios distintos. El cliente elige por WhatsApp y aprueba con firma digital.",
      },
      {
        title: "Reparación con trazabilidad",
        description:
          "Cambiás componentes, instalás sistema operativo, configurás programas; cada paso queda registrado con nombre del técnico y hora. Evidencia útil si el equipo vuelve con un problema.",
      },
      {
        title: "Entrega con garantía segmentada",
        description:
          "El cliente se lleva la PC con garantía específica por cada componente nuevo (por ejemplo 6 meses en un SSD, 30 días en mano de obra). El sistema te avisa si vuelve dentro del período cubierto.",
      },
    ],
    specificFeatures: [
      {
        title: "Plantillas de diagnóstico reutilizables",
        description:
          "Creá plantillas para PCs de escritorio, notebooks, all-in-one y servidores. El técnico las carga en un click y tilda lo revisado en lugar de escribir todo desde cero en cada orden.",
      },
      {
        title: "Presupuestos multi-opción",
        description:
          "Ofrecé al cliente hasta tres alternativas numeradas de reparación (ej: Opción 1: cambio de SSD, Opción 2: también más RAM, Opción 3: equipo reacondicionado). El cliente aprueba una sola.",
      },
      {
        title: "Garantía por componente",
        description:
          "Cada pieza instalada (SSD, RAM, batería de notebook, fuente) tiene su propia fecha de garantía independiente. Crítico cuando un mismo equipo tiene repuestos con distintos plazos del fabricante.",
      },
      {
        title: "Clientes empresariales y mantenimiento",
        description:
          "Etiquetás clientes como empresariales, cargás convenios con tarifas diferenciadas y generás reportes mensuales consolidados de todos los equipos reparados por esa empresa.",
      },
    ],
    faqs: [
      {
        question: "¿Puedo registrar trabajos de formateo e instalación además de reparaciones físicas?",
        answer:
          "Sí. Creás tipos de orden distintos (reparación de hardware, formateo, instalación de Office, recuperación de datos, limpieza y mantenimiento), cada uno con su tarifa y tiempo estimado. Todo entra en el historial del cliente y del equipo.",
      },
      {
        question: "¿Cómo manejo presupuestos con varias opciones de reparación?",
        answer:
          "Armás un presupuesto con alternativas numeradas (por ejemplo: Opción 1: cambio de SSD $X, Opción 2: también más RAM $Y, Opción 3: equipo completo reacondicionado $Z). El cliente lo recibe por WhatsApp y aprueba la elegida con firma digital. Queda registrado qué eligió y por qué.",
      },
      {
        question: "¿Sirve para PCs de empresas con contratos de mantenimiento?",
        answer:
          "Sí. Podés etiquetar clientes como empresariales, cargar convenios con tarifas diferenciadas y generar reportes mensuales consolidados de todos los equipos reparados. También facturás los contratos de mantenimiento preventivo de forma recurrente.",
      },
      {
        question: "¿El sistema lleva historial por equipo aunque cambie el cliente?",
        answer:
          "Sí. Cada PC o notebook se identifica por número de serie. Si un cliente te vende la PC a otro y el nuevo dueño vuelve al taller, vos ya tenés el historial técnico completo de ese equipo: todo lo que se reparó, qué componentes se cambiaron y las garantías vigentes.",
      },
      {
        question: "¿Puedo controlar las garantías de los componentes que instalo?",
        answer:
          "Cada componente que cargás tiene su propia garantía (la del fabricante más la tuya). El sistema te avisa cuando un cliente vuelve con un equipo y algún componente está dentro del período cubierto, para no cobrar de más ni discutir cuándo compró qué.",
      },
    ],
    relatedSlugs: ["electronicos", "celulares"],
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
      "Tablets, consolas, equipos de audio, cámaras: si lo reparás, STApp lo gestiona. Un solo sistema flexible para cualquier tipo de dispositivo electrónico.",
    cardDescription:
      "Un solo sistema flexible para cualquier electrónico: órdenes a medida, stock por categorías libres y reportes por rubro.",
    longIntro: [
      "Los talleres de electrónica general (microondas, equipos de audio, TVs, cámaras, monitores, pequeños electrodomésticos) enfrentan un desafío distinto a los talleres de un solo tipo de dispositivo: cada equipo que entra es diferente, cada marca usa componentes propios y los repuestos van desde capacitores sueltos hasta plaquetas completas. Los software pensados para un vertical específico te fuerzan a encajar tu realidad en formatos cerrados.",
      "STApp te permite gestionar esa variedad sin casarte con un formato rígido. Creás tipos de dispositivo con campos propios (un microondas lleva magnetrón y plato giratorio; un amplificador lleva transistores de salida y relés), organizás el stock por categorías libres y tenés reportes que te dicen qué rubro te deja más plata y cuál consume más tiempo. Ideal para talleres generalistas que no encajan en software hecho para un solo vertical.",
    ],
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
    workflow: [
      {
        title: "Recepción del equipo",
        description:
          "Seleccionás o creás el tipo de dispositivo (TV LED, microondas, consola de sonido, proyector) y el sistema te pide los datos específicos de ese tipo. Nada de campos vacíos ni irrelevantes.",
      },
      {
        title: "Diagnóstico con mediciones",
        description:
          "Cargás las mediciones eléctricas relevantes (tensiones en la fuente, resistencia de bobinados, comportamiento bajo carga), el técnico deja notas y fotos del interior. Queda como referencia técnica para equipos similares.",
      },
      {
        title: "Búsqueda de repuestos",
        description:
          "El catálogo busca por código de parte o descripción libre; si el componente no está cargado, lo creás sin salirte del flujo de la orden. No perdés tiempo volviendo al módulo de inventario.",
      },
      {
        title: "Reparación y test",
        description:
          "Reemplazás componentes, hacés la prueba de funcionamiento bajo carga real, documentás con foto o video cuando hace falta. Crítico si después el cliente discute qué se hizo.",
      },
      {
        title: "Entrega con explicación",
        description:
          "Generás el comprobante que explica qué se cambió y por qué, con garantía sobre la reparación específica. El cliente se lleva un respaldo claro y el taller, la trazabilidad.",
      },
    ],
    specificFeatures: [
      {
        title: "Tipos de dispositivo personalizables",
        description:
          "No te casás con categorías cerradas: creás 'cafetera express', 'mezclador de DJ', 'proyector LED', 'plaqueta automotriz', lo que reparás, con los campos que te sirven.",
      },
      {
        title: "Stock con categorías libres",
        description:
          "Organizás el inventario como te convenga: por tipo de componente (capacitores, transistores, relés, integrados), por tipo de equipo compatible, por proveedor o por varias etiquetas cruzadas.",
      },
      {
        title: "Mediciones eléctricas en la orden",
        description:
          "Campos numéricos para voltaje, corriente, resistencia, con histórico que te sirve como referencia técnica para equipos del mismo modelo que entren después.",
      },
      {
        title: "Reportes por rubro",
        description:
          "Sabés exactamente cuánto factura tu taller por audio, por microondas, por TVs, y dónde ajustar precios o dejar de aceptar equipos poco rentables. Ordenás tu mix de trabajo con datos, no intuición.",
      },
    ],
    faqs: [
      {
        question: "¿STApp sirve si reparo cosas muy diversas, desde microondas hasta plaquetas de autos?",
        answer:
          "Sí. El sistema no te obliga a trabajar con categorías predefinidas. Creás los tipos de dispositivo que vos reparás ('microondas', 'ECU automotriz', 'balanza electrónica') con los campos que te sirven, y gestionás todo desde el mismo panel. No hay formato rígido que se imponga a tu realidad.",
      },
      {
        question: "¿Cómo organizo un inventario con componentes muy variados?",
        answer:
          "Usás categorías libres que vos definís. Podés organizar por tipo de componente (capacitores electrolíticos, resistencias SMD, relés, integrados), por tipo de equipo compatible (audio, TV, electrodomésticos) o por proveedor. Cada producto lleva múltiples etiquetas para encontrarlo rápido.",
      },
      {
        question: "¿Puedo manejar reparaciones con piezas que pido al exterior?",
        answer:
          "Sí. Marcás la orden como 'esperando importación', con tiempo estimado. El cliente ve ese estado en su link de seguimiento y recibe una notificación cuando la pieza llega y la reparación se reanuda. Evitás las llamadas semanales preguntando 'cómo va'.",
      },
      {
        question: "¿Sirve para hacer presupuestos antes de abrir el equipo?",
        answer:
          "Sí. Podés cobrar un 'cargo por diagnóstico' como orden aparte, dar un presupuesto estimativo y, cuando el cliente aprueba, pasás al trabajo completo. Todo queda trazado: diagnóstico, presupuesto, aprobación y reparación en el mismo historial.",
      },
      {
        question: "¿Cómo cobro si el cliente suma tareas después de abrir la orden?",
        answer:
          "Abrís la orden con el trabajo original y si el cliente suma tareas (cambio de un capacitor adicional, limpieza interna, re-soldadura de pines) agregás los ítems a la misma orden. El cliente ve todo actualizado por WhatsApp y aprueba los extras antes de que los hagas.",
      },
    ],
    relatedSlugs: ["consolas", "computadoras"],
    keywords: [
      "software reparación electrónicos",
      "sistema taller electrónica",
      "gestión reparaciones electrónicos",
      "software taller reparaciones",
      "sistema servicio técnico electrónica",
      "órdenes trabajo electrónicos",
    ],
  },
  {
    slug: "tablets",
    title: "Reparación de Tablets",
    metaTitle: "Software para Taller de Reparación de Tablets | STApp",
    metaDescription:
      "Sistema de gestión para talleres de reparación de tablets y iPads. Órdenes de trabajo, seguimiento de reparaciones, inventario de pantallas y repuestos.",
    icon: Tablet,
    heroTitle: "El software ideal para tu taller de",
    heroHighlight: "reparación de tablets",
    heroDescription:
      "Gestioná reparaciones de iPads, tablets Samsung, Lenovo y más. Registrá diagnósticos, controlá stock de pantallas y digitalizadores, y mantené informado a tu cliente.",
    cardDescription:
      "Stock por modelo, presupuestos según el tipo de pantalla y seguimiento por WhatsApp para iPads y tablets Android.",
    longIntro: [
      "Las tablets parecen celulares grandes pero en la mesa del técnico son otra cosa. Los iPad requieren herramientas específicas y pegamento caliente, las Samsung Galaxy Tab usan displays únicos por modelo, y una Lenovo no cruza repuestos con una Huawei. Los clientes (padres con tablets de los chicos, comercios con terminales Android para pedidos, empresas con iPads para ventas en la calle) llegan con equipos distintos y el taller que no ordena su stock por modelo termina perdiendo plata en repuestos mal comprados.",
      "STApp ordena ese caos. Organizás el stock por marca y modelo exacto (iPad Pro 11\" 3ra gen, Samsung Tab A7 Lite, Lenovo Tab M10 Plus), generás presupuestos diferenciados según si es cambio de digitalizador, pantalla completa o solo vidrio, y el cliente sigue su reparación por WhatsApp sin tener que llamarte. Todo diseñado para que un taller con volumen de tablets pueda escalar sin volverse un desastre operativo.",
    ],
    problems: [
      "Las tablets tienen repuestos específicos y es difícil mantener stock organizado",
      "Los clientes no saben el estado de su tablet y llaman constantemente",
      "Necesitás diferenciar reparaciones de pantalla, batería y software",
      "Los presupuestos varían mucho según el modelo y no tenés un sistema ágil",
    ],
    solutions: [
      {
        title: "Inventario por modelo",
        description:
          "Organizá pantallas, digitalizadores, baterías y flex por marca y modelo de tablet. Alertas de stock bajo para no perder ventas.",
      },
      {
        title: "Seguimiento en tiempo real",
        description:
          "Tu cliente accede a un link único para ver el estado de su tablet: recibida, en diagnóstico, esperando repuesto, reparada, lista.",
      },
      {
        title: "Presupuestos rápidos",
        description:
          "Generá presupuestos profesionales en segundos seleccionando el tipo de reparación y el modelo de tablet.",
      },
      {
        title: "Historial completo",
        description:
          "Cada tablet queda registrada con su historial de reparaciones, fotos del antes y después, y datos de garantía.",
      },
    ],
    workflow: [
      {
        title: "Identificación del modelo",
        description:
          "Escaneás el número de serie o cargás marca y modelo; el sistema muestra repuestos compatibles en stock y el tiempo estimado típico para esa reparación en particular.",
      },
      {
        title: "Diagnóstico específico",
        description:
          "Tildás qué falla (vidrio, display, táctil, batería, conector de carga, altavoz, software). Cada tipo de falla tiene su presupuesto asociado precargado, así ganás velocidad al presupuestar.",
      },
      {
        title: "Presupuesto y aprobación",
        description:
          "Enviás el presupuesto por WhatsApp; el cliente aprueba y elige si es express o normal. El precio se ajusta según la opción elegida y el ETA se comunica automáticamente.",
      },
      {
        title: "Reparación registrada",
        description:
          "Fotos antes, durante y después de la reparación, registro de pegamento usado (B-7000, OCA), cinta usada y tiempo efectivo. Protege al taller de reclamos y sirve para ajustar márgenes.",
      },
      {
        title: "Retiro con prueba",
        description:
          "El cliente prueba el táctil y la respuesta frente al técnico, firma la entrega conforme y recibe garantía específica del repuesto instalado. Reclamos posteriores tienen menos margen de discusión.",
      },
    ],
    specificFeatures: [
      {
        title: "Stock diferenciado por tipo de pantalla",
        description:
          "Separás vidrio solo, vidrio + táctil y pantalla completa (LCD + táctil unificado). Cada una tiene su precio y disponibilidad distinta, y el presupuesto se arma con la opción correcta.",
      },
      {
        title: "Tiempo de reparación por modelo",
        description:
          "El sistema aprende cuánto tarda en promedio una reparación por modelo (basado en órdenes históricas) y te da estimaciones confiables para presupuestar plazos a nuevos clientes.",
      },
      {
        title: "Control de adhesivos y herramientas",
        description:
          "Registrás uso de pegamento B-7000, cinta OCA, kits de apertura y herramientas específicas que tienen costo y se acaban. Eso entra al costo real de la reparación y evita que vendas por debajo del costo.",
      },
      {
        title: "Seguimiento web con link único",
        description:
          "El cliente abre un link sin descargar nada, ve el estado de su iPad, el ETA actualizado, las fotos del equipo y el presupuesto. Cero fricción: nadie tiene que instalar una app para ser cliente.",
      },
    ],
    faqs: [
      {
        question: "¿Puedo manejar reparaciones de tablets con displays difíciles de conseguir?",
        answer:
          "Sí. Marcás la orden como 'esperando importación' o 'repuesto pedido', con un tiempo estimado. El cliente lo ve en su link de seguimiento y recibe una notificación cuando la pieza llega. Si cambia el tiempo, actualizás el ETA y el cliente se entera automáticamente sin que tengas que escribirle.",
      },
      {
        question: "¿Cómo diferencio presupuestos entre cambio de vidrio y de pantalla completa?",
        answer:
          "En el catálogo cargás ambas opciones por modelo (vidrio solo vs. pantalla completa con LCD), cada una con su costo y tarifa de mano de obra. Al armar el presupuesto seleccionás cuál aplica, y si el diagnóstico cambia (el LCD también estaba dañado) actualizás la orden y el cliente aprueba la diferencia por WhatsApp.",
      },
      {
        question: "¿Sirve para iPads con software (activación, iCloud, restore)?",
        answer:
          "Sí. Creás un tipo de orden 'software/desbloqueo' con sus propios estados: recibido, intento de restore, en proceso de liberación, entregado. Funciona igual que una reparación física, con presupuesto, aprobación y notificaciones, pero ajustado al flujo de trabajo de software.",
      },
      {
        question: "¿Puedo llevar historial por tablet con el número de serie?",
        answer:
          "Sí. Cada tablet se identifica por número de serie o IMEI. Si un cliente vuelve con la misma tablet seis meses después, tenés el historial completo: qué se reparó, qué repuesto se usó, qué garantía tiene vigente. Especialmente útil para reclamos por garantía.",
      },
      {
        question: "¿Cómo manejo clientes con varias tablets (colegios, oficinas)?",
        answer:
          "Creás el cliente como 'empresa' y asociás varios dispositivos al mismo contacto. Al entregar generás un remito consolidado por las tablets que se retiran, con firma digital del responsable. Para el mantenimiento recurrente, el historial por equipo te deja ver cuál se rompe más y sugerir reemplazos.",
      },
    ],
    relatedSlugs: ["celulares", "electronicos"],
    keywords: [
      "software reparación tablets",
      "sistema taller tablets",
      "gestión reparaciones iPad",
      "software taller tablets",
      "órdenes trabajo tablets",
      "inventario repuestos tablets",
    ],
  },
  {
    slug: "consolas",
    title: "Reparación de Consolas",
    metaTitle: "Software para Taller de Reparación de Consolas | STApp",
    metaDescription:
      "Sistema de gestión para talleres de reparación de consolas de videojuegos. PlayStation, Xbox, Nintendo Switch. Órdenes de trabajo, inventario y seguimiento.",
    icon: Gamepad2,
    heroTitle: "Gestioná tu taller de reparación de",
    heroHighlight: "consolas de videojuegos",
    heroDescription:
      "PlayStation, Xbox, Nintendo Switch: administrá reparaciones de consolas con un sistema profesional. Control de órdenes, repuestos y comunicación con clientes.",
    cardDescription:
      "Órdenes, stock por plataforma y garantía con fotos para PlayStation, Xbox y Nintendo Switch.",
    longIntro: [
      "Las reparaciones de consolas tienen picos estacionales (post-Navidad, vacaciones, lanzamientos grandes), clientes jóvenes muy exigentes con el tiempo y fallas técnicas específicas que no se parecen a otras reparaciones: drift de joysticks, lectores ópticos que no leen discos, ventiladores ruidosos, cambio de pasta térmica en PS4 y PS5, HDMI quemado por conexión indebida, Switch con problemas de carga o joycons desincronizados.",
      "STApp gestiona tu taller de consolas pensando en esto. Categorizás por plataforma (PlayStation, Xbox, Nintendo), llevás stock específico (joycons, lectoras, ventiladores, pasta térmica de calidad), y el cliente gamer sigue cada paso por WhatsApp. Además, documentás garantía digital con fotos del antes/después. En este rubro los reclamos por 'me lo devolvieron peor' son frecuentes, y la evidencia visual te protege.",
    ],
    problems: [
      "Las consolas requieren diagnósticos técnicos específicos difíciles de documentar",
      "Los repuestos de consolas son variados y de alta rotación en temporadas",
      "Los clientes gamers son exigentes y quieren saber el estado exacto",
      "Las garantías de reparación de consolas son críticas y se pierden sin sistema",
    ],
    solutions: [
      {
        title: "Diagnóstico detallado",
        description:
          "Campos personalizados para cada tipo de consola: problemas de HDMI, ventiladores, lectoras, joysticks, placas. Todo documentado.",
      },
      {
        title: "Stock por consola",
        description:
          "Organizá repuestos por tipo de consola: PS5, Xbox Series, Switch. Controlá el stock de componentes específicos con alertas automáticas.",
      },
      {
        title: "Notificaciones instantáneas",
        description:
          "Avisá a tu cliente por WhatsApp cuando su consola esté lista. Sin llamadas, sin demoras.",
      },
      {
        title: "Garantía documentada",
        description:
          "Cada reparación queda con garantía registrada digitalmente. El cliente accede a su comprobante desde cualquier dispositivo.",
      },
    ],
    workflow: [
      {
        title: "Recepción con serial",
        description:
          "Cargás la consola por número de serie y modelo (PS5 Digital, Xbox Series S, Switch OLED, PS4 Slim). El sistema muestra fallas típicas de ese modelo para orientar el diagnóstico desde el arranque.",
      },
      {
        title: "Diagnóstico visual y técnico",
        description:
          "Abrís la consola, fotografiás componentes, detectás la falla (lector KEM-497, ventilador trabado, joystick con drift, placa con corto). Cargás el resultado con evidencia visual del estado interno.",
      },
      {
        title: "Presupuesto con alternativas",
        description:
          "Algunas fallas tienen varias soluciones (limpieza profunda + cambio de pasta térmica vs. cambio de ventilador). Ofrecés opciones al cliente y él elige según presupuesto y urgencia.",
      },
      {
        title: "Reparación con registro fotográfico",
        description:
          "Foto antes, durante (con los componentes cambiados) y después de la reparación. Esto te protege frente a reclamos 'me lo devolvieron rayado' o 'faltaba un tornillo', que son habituales en el rubro.",
      },
      {
        title: "Test extendido y entrega",
        description:
          "Probás la consola con un juego real durante 15-30 minutos para detectar sobrecalentamiento o drift residual antes de avisarle al cliente que está lista. El estado pasa de 'en test' a 'lista' solo si el test es exitoso.",
      },
    ],
    specificFeatures: [
      {
        title: "Stock por plataforma",
        description:
          "Separás joycons Switch, joysticks PS4/PS5, drives ópticos Xbox, ventiladores, pasta térmica premium, con stock visible por plataforma para planificar picos de demanda estacionales.",
      },
      {
        title: "Diagnóstico por falla típica",
        description:
          "El sistema te sugiere las causas más frecuentes por modelo (ej: PS4 Fat con overheating suele ser pasta térmica vieja; Switch con drift, cambio de módulo de joystick) con tiempos estimados asociados.",
      },
      {
        title: "Evidencia fotográfica obligatoria",
        description:
          "Configurás que ciertas etapas requieren foto para avanzar de estado. Crítico en consolas donde los reclamos post-reparación son habituales y la foto resuelve la discusión.",
      },
      {
        title: "Garantía diferenciada por tipo de trabajo",
        description:
          "Una limpieza lleva 30 días de garantía, un cambio de placa madre 6 meses, un joycon nuevo 90 días. Cada trabajo genera su propio comprobante con alcance y plazo específicos.",
      },
    ],
    faqs: [
      {
        question: "¿Gestiono tanto reparaciones físicas como temas de software (backup de saves, recupero de cuenta)?",
        answer:
          "Sí. Creás tipos de orden separados (reparación de hardware, backup de juegos, recupero de partidas guardadas, actualización de firmware), cada uno con su flujo, tarifa y plazos. Todo en el mismo panel, con el mismo cliente y la misma consola identificada por serial.",
      },
      {
        question: "¿Cómo manejo las temporadas altas cuando entran muchas consolas juntas?",
        answer:
          "El panel de órdenes por estado te deja ver en una pantalla cuántas consolas están en diagnóstico, cuántas esperando repuesto, cuántas en reparación. Asignás técnicos por tipo de trabajo (uno a lectoras, otro a joysticks, otro a placas) y los clientes ven su lugar en la cola vía WhatsApp.",
      },
      {
        question: "¿Sirve para llevar control de repuestos específicos como lectoras o ventiladores?",
        answer:
          "Sí. Cargás cada repuesto con su código de parte (ej: 'lectora KEM-497AAA para PS4 Slim'), marcás compatibilidad con modelos puntuales y el sistema te alerta cuando el stock baja. Especialmente útil en drives y joysticks que tienen alta rotación.",
      },
      {
        question: "¿Cómo documento reparaciones para evitar discusiones cuando el cliente retira?",
        answer:
          "Fotos al ingresar (estado externo, rayones previos), fotos durante la reparación (componentes cambiados), foto del test final. Todo linkeado a la orden, y el cliente firma al retirar que recibió conforme. Frente a un reclamo, tenés la evidencia cronológica.",
      },
      {
        question: "¿Manejo garantías distintas por tipo de reparación?",
        answer:
          "Sí. Cada tipo de trabajo tiene su garantía por defecto configurable: limpieza y mantenimiento 30 días, cambio de componentes 3 a 6 meses, cambios de placa o soldaduras mayores 6 meses. Al entregar, el comprobante se genera con la fecha y el alcance específico.",
      },
    ],
    relatedSlugs: ["celulares", "electronicos"],
    keywords: [
      "software reparación consolas",
      "sistema taller consolas",
      "gestión reparaciones PlayStation",
      "software taller consolas videojuegos",
      "reparación Xbox Nintendo Switch",
      "órdenes trabajo consolas",
    ],
  },
]

export function getUseCase(slug: string): UseCase | undefined {
  return useCases.find((uc) => uc.slug === slug)
}
