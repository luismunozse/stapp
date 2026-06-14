# STApp — Respuesta a tus consultas

Gracias por las preguntas. Abajo respondemos una por una, con honestidad: lo que ya está, lo que está parcial y lo que está en el roadmap. STApp es un sistema de gestión para servicio técnico / talleres de reparación, pensado y alojado para Argentina (precios en ARS, zona horaria local, MercadoPago).

**Referencia rápida:**
✅ Disponible · 🟡 Parcial · 🗺️ En roadmap

---

## 1. ¿Mide tiempo por técnico en cada orden de trabajo? 🟡

Sí, en dos formas:
- **Tiempo por estado**: el sistema registra automáticamente cuánto tiempo estuvo cada orden en cada etapa (recibido, en diagnóstico, en reparación, etc.).
- **Horas de mano de obra por orden**: el técnico/admin carga las horas trabajadas en cada orden, que se usan para el costo de mano de obra (ver punto 3).

Lo que todavía **no** hay es un cronómetro de fichada automática (start/stop) por técnico. Está en roadmap.

## 2. ¿Rentabilidad por reparación, por técnico y por período? 🟡

- **Por reparación y por tipo de equipo**: sí. El reporte de rentabilidad muestra ingresos vs. costos (repuestos + comisión + **mano de obra**) y margen resultante.
- **Por técnico**: hay base de datos para esto (comisiones y costo de mano de obra por orden), pero la pantalla dedicada de "rentabilidad por técnico" está en roadmap.
- **Por período**: los reportes hoy son acumulados; el filtro fino por rango de fechas en este reporte está en roadmap.

## 3. ¿Cargar costo interno de mano de obra o valor hora por empleado? ✅

Sí. Cada empleado tiene un **costo por hora** configurable. En cada orden se cargan las **horas trabajadas**, y el sistema calcula el costo de mano de obra y lo **descuenta de la rentabilidad**. El valor hora queda "fotografiado" en la orden al asignar el técnico, así un cambio de tarifa no altera el histórico.

## 4. ¿Registrar repuestos usados y descontarlos del stock? ✅

Sí. Los repuestos consumidos en una orden se descuentan del inventario de forma atómica (sin descuadres), con registro de movimiento de stock. También admite repuestos manuales (fuera de inventario).

## 5. ¿Adjuntar fotos del equipo, número de serie y accesorios recibidos? ✅

Sí. Fotos por etapa (ingreso, reparación, entrega), número de serie/IMEI, marca, color, accesorios recibidos y un checklist de recepción con firma digital del cliente.

## 6. ¿Historial completo de cambios por usuario? ✅

Sí. Registro de auditoría por usuario (qué cambió, cuándo, desde qué IP) y una línea de tiempo de eventos por orden (cambios de estado, fotos, presupuestos, notas, repuestos).

## 7. ¿Estados personalizados? 🗺️

Hoy los estados de orden son un conjunto fijo y completo (recibido, en diagnóstico, presupuestado, aprobado, en reparación, esperando repuesto, reparado, entregado, cancelado, sin reparación). Estados **configurables por el usuario** están en roadmap.

## 8. ¿Reportes exportables a Excel? ✅

Sí. Exportación a **Excel (.xlsx)** y CSV de órdenes, ventas, clientes, inventario y garantías.

## 9. ¿API o integración con otros sistemas? 🟡

- **Webhooks salientes**: sí. Podés suscribir eventos y enviarlos a otros sistemas (con firma HMAC, reintentos e historial de entregas).
- **API REST pública entrante** (con API keys para que sistemas externos consulten/escriban): en roadmap.

## 10. ¿Se puede importar la base actual de clientes/equipos desde Sat Manager? ✅

Sí. Importación de clientes e inventario por CSV/Excel, con detección flexible de encabezados (mapea exportaciones de otros sistemas) y deduplicación. Una exportación de Sat Manager se puede mapear e importar.

## 11. ¿Usuarios con permisos por rol? ✅

Sí. Tres roles (Administrador, Técnico, Vendedor) con permisos diferenciados, aplicados tanto en la app como a nivel de base de datos (aislamiento por organización).

## 12. ¿Notificaciones por WhatsApp o email? ✅

Sí, ambos. WhatsApp (API de WhatsApp Business + proveedor alternativo) con plantillas, y email. Registro de todos los envíos.

## 13. ¿Qué pasa si dejo de pagar? ¿Puedo exportar toda mi información? ✅

**Sí, tus datos son tuyos.** La exportación de tus datos (clientes, órdenes, ventas, inventario, garantías) está **siempre disponible**, en cualquier plan e incluso con la suscripción pausada — hay un acceso directo de "Exportá tus datos" en la pantalla de cuenta. No quedás encerrado.

## 14. ¿Funciona desde el celular para que los técnicos carguen avances? ✅

Sí. App nativa Android + versión web responsive (PWA) con soporte offline. Los técnicos cargan avances, fotos y horas desde el celular.

## 15. ¿Tiene soporte en Argentina? ✅

Sí. STApp es Argentina-first: precios en ARS, zona horaria local, facturación pensada para servicio técnico en Argentina, y cobros con MercadoPago. También soporta multi-moneda para otros países de LATAM.

---

## Resumen

| # | Consulta | Estado |
|---|----------|--------|
| 1 | Tiempo por técnico por orden | 🟡 Tiempo por estado + horas manuales (falta fichada auto) |
| 2 | Rentabilidad por reparación/técnico/período | 🟡 Por reparación y tipo sí; por técnico/período en roadmap |
| 3 | Valor hora / costo mano de obra | ✅ |
| 4 | Repuestos + descuento de stock | ✅ |
| 5 | Fotos, n° de serie, accesorios | ✅ |
| 6 | Historial de cambios por usuario | ✅ |
| 7 | Estados personalizados | 🗺️ Roadmap |
| 8 | Exportable a Excel | ✅ |
| 9 | API / integración | 🟡 Webhooks salientes; API entrante en roadmap |
| 10 | Importar clientes/equipos | ✅ |
| 11 | Permisos por rol | ✅ |
| 12 | WhatsApp / email | ✅ |
| 13 | Exportar todo si dejo de pagar | ✅ |
| 14 | Celular para técnicos | ✅ |
| 15 | Soporte en Argentina | ✅ |

**11 ✅ · 3 🟡 · 1 🗺️**

## Roadmap (lo que viene)

- Fichada de tiempo automática por técnico (cronómetro start/stop).
- Reporte de rentabilidad por técnico y filtro por rango de fechas.
- Estados de orden configurables por el usuario.
- API REST pública entrante con API keys.

Quedamos a disposición para una demo y para coordinar la migración de tu base actual.
