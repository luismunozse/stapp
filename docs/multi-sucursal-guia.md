# Multi-Sucursal — Guía de uso y pruebas

Sistema multi-sucursal de STApp. Permite a una organización operar varios talleres con datos
aislados por sucursal, manteniendo el control consolidado a nivel ADMIN.

## Conceptos clave

| Concepto | Qué es |
|---|---|
| **Sucursal** | Un taller/local de la organización. Cada org tiene 1 o más. |
| **Principal** | La sucursal por defecto. Exactamente una por org. Recibe las escrituras cuando el ADMIN está en modo "Todas las sucursales". |
| **Switcher** | Selector arriba a la derecha (solo ADMIN, solo si hay >1 sucursal). Cambia la sucursal activa. |
| **Sucursal activa** | La elegida en el switcher. Se guarda en cookie `stapp-sucursal-activa` (httpOnly, 1 año). |
| **"Todas las sucursales"** | Modo ADMIN que ve datos consolidados de toda la org (sin filtro por sucursal). |

## Cómo funciona el aislamiento

### Lectura (qué ve cada quién)

- **ADMIN con sucursal activa X** → ve solo datos de X.
- **ADMIN en "Todas las sucursales"** → ve todo consolidado (sin filtro).
- **TÉCNICO / VENDEDOR** → ve solo su sucursal asignada (`users.sucursal_id`). **El switcher no aplica** —
  su scope es fijo, ignora la cookie.

### Escritura (dónde caen los datos nuevos)

- **ADMIN con sucursal activa X** → escribe en X.
- **ADMIN en "Todas las sucursales"** → escribe en la **principal**.
- **TÉCNICO / VENDEDOR** → escribe en su sucursal asignada.

## Qué está aislado por sucursal

**Filtrado por sucursal:**
- Órdenes de servicio
- Ventas (POS)
- Caja (sesiones + movimientos) — el arqueo de cierre cuenta solo la sucursal de la sesión
- Turnos (agenda)
- Depósitos
- Ajustes de inventario (mermas/roturas)
- **Todos los reportes** — incluido el Estado de Resultados (P&L) por sucursal
- Exportaciones CSV/XLSX de órdenes y ventas
- API pública v1 de órdenes (vía `?sucursal_id=`)

**Org-wide (compartido entre sucursales, por diseño):**
- Clientes (CRM compartido)
- Catálogo de inventario / stock (el stock es centralizado; el detalle por depósito es multi-depósito)
- Configuración, facturación, proveedores
- Exportación de clientes e inventario

## Planes y límites

| Plan | Límite de sucursales |
|---|---|
| Free | 1 |
| Emprendedor | 1 |
| Profesional | 3 |
| Pro | Ilimitado (plan aún no activo) |

Al intentar crear una sucursal sobre el límite → HTTP 403 con mensaje de upgrade.

---

# Guía de pruebas

> Requisito: usuario **ADMIN** en una org con plan **Profesional** (permite hasta 3 sucursales).

## Preparación

### 1. Crear sucursales
1. Ir a **`/configuracion/sucursales`**.
2. Crear la segunda sucursal (la org ya tiene "Casa Central" como principal por defecto).
   - Campo obligatorio: **nombre** (único por org).
   - Opcionales: código, dirección, teléfono, notas.
3. Crear una tercera si querés probar el límite del plan.
4. **Probar límite:** intentar crear una 4ta en plan Profesional → debe rechazar con mensaje de upgrade.

### 2. Verificar el switcher
- Con 1 sola sucursal: el switcher **no aparece** (correcto).
- Con 2+ sucursales: aparece arriba a la derecha (solo en desktop, solo ADMIN).
- Opciones: "Todas las sucursales" + una por cada sucursal activa.

### 3. Asignar personal a sucursales
1. Crear un **técnico** (`/configuracion` → técnicos) → al haber >1 sucursal, aparece selector de sucursal.
2. Crear un **vendedor** → mismo selector.
   - Nota: la asignación de sucursal solo se hace **al crear**, no al editar.

## Casos de prueba

### A. Aislamiento de escritura (ADMIN)
1. Switcher → **Sucursal A**.
2. Crear una orden de servicio + una venta POS.
3. Switcher → **Sucursal B**.
4. Crear otra orden + otra venta.
5. **Verificar:** en Sucursal A solo se ven los datos de A; en B solo los de B.

### B. Vista consolidada (ADMIN)
1. Switcher → **Todas las sucursales**.
2. **Verificar:** se ven las órdenes y ventas de A **y** B juntas.
3. Crear una orden nueva en este modo.
4. **Verificar:** la orden cayó en la sucursal **principal** (Casa Central por defecto).

### C. Scope de personal no-ADMIN
1. Login como el **técnico** asignado a Sucursal A.
2. **Verificar:** solo ve órdenes de A. No tiene switcher.
3. Login como **vendedor** de Sucursal B → solo ve ventas de B.

### D. Reportes por sucursal
1. Como ADMIN, switcher → **Sucursal A**.
2. Ir a Reportes avanzados.
3. **Verificar:** el header muestra "Viendo: Sucursal A". Los números (ingresos, rentabilidad,
   estado de resultados) reflejan solo A.
4. Switcher → **Todas las sucursales**.
5. **Verificar:** header muestra "Todas las sucursales"; los totales = suma de A + B.
   - *Invariante clave:* `total(A) + total(B) = total(consolidado)`.
6. **Reportes de inventario** (análisis-inventario): siempre muestran badge "Toda la organización"
   (el inventario es centralizado).

### E. Caja por sucursal
1. Abrir sesión de caja en Sucursal A, registrar movimientos.
2. Switcher → Sucursal B, abrir otra sesión, registrar movimientos.
3. Cerrar la sesión de A.
4. **Verificar:** el arqueo de A cuenta **solo** los movimientos de A (no se mezcla con B).

### F. Exportación
1. Switcher → Sucursal A → exportar órdenes (CSV/XLSX).
2. **Verificar:** el archivo trae solo órdenes de A.
3. Exportar clientes → trae todos (org-wide, correcto).

### G. Turnos
1. Switcher → Sucursal A → crear un turno.
2. **Verificar:** el turno queda en A; en Sucursal B no aparece.
3. La disponibilidad de técnicos NO se filtra por sucursal (un técnico no puede estar en dos
   lugares a la vez, sin importar la sucursal).

### H. API pública v1
```
# Todas las órdenes de la org (sin filtro):
GET /api/v1/ordenes
Authorization: Bearer <api_key>

# Filtrada por sucursal:
GET /api/v1/ordenes?sucursal_id=<id_sucursal>
Authorization: Bearer <api_key>
```
- **Verificar:** con `sucursal_id` válido de tu org → filtra. Con uno de otra org → **404**
  (no filtra ni revela existencia). Sin el parámetro → org-wide.

## Checklist rápido

- [ ] Crear sucursales (y probar límite del plan)
- [ ] Switcher visible solo con >1 sucursal y solo ADMIN
- [ ] Escritura cae en la sucursal activa / principal según corresponda
- [ ] Técnico/vendedor ven solo su sucursal
- [ ] Reportes filtran por sucursal y consolidan en "Todas"
- [ ] Arqueo de caja no mezcla sucursales
- [ ] Export filtra órdenes/ventas, clientes quedan org-wide
- [ ] Turnos por sucursal; disponibilidad sin filtrar
- [ ] API v1 `?sucursal_id=` valida ownership (404 cross-org)

## Referencia técnica

| Detalle | Valor |
|---|---|
| Cookie sucursal activa | `stapp-sucursal-activa` (httpOnly) |
| localStorage (label UI) | `sucursal-activa-ui` |
| Endpoint crear | `POST /api/sucursales` (ADMIN) |
| Endpoint cambiar activa | `POST /api/sucursales/set-activa` (ADMIN) |
| Helper lectura | `sucursalParaLectura()` → `{ sucursalId, verTodas }` |
| Helper escritura | `sucursalParaEscritura()` → `string \| null` |
| Validación cross-org | `assertSucursalEnOrg(sucursalId, orgId)` |
