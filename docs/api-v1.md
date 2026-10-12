# STApp API v1 (pública, read-only)

API REST para que sistemas externos consulten los datos de tu organización. Versión 1: **solo lectura**.

## Autenticación

Header `Authorization: Bearer <API_KEY>`.

Las API keys se crean desde **Configuración → API Keys**. El valor crudo (`stapp_live_...`) se muestra **una sola vez** al crearla — guardalo en un lugar seguro. En la base se guarda solo un hash (sha256), así que no se puede recuperar; si la perdés, revocá y creá una nueva.

Las keys se scopean a tu organización: una key solo accede a los datos de tu org.

## Base URL

```
https://<tu-subdominio>.stapp.com.ar/api/v1
```

## Convenciones

- **Paginación**: `?page=1&limit=20` (`limit` máximo 100).
- **Respuesta de lista**:
  ```json
  {
    "data": [ ... ],
    "total": 123,
    "page": 1,
    "limit": 20,
    "totalPages": 7
  }
  ```
- **Errores**:
  - `401` `{ "error": "...", "code": "UNAUTHORIZED" }` — key faltante, inválida o revocada.
  - `429` `{ "error": "Demasiadas solicitudes", "code": "RATE_LIMITED" }` — límite de tasa.
  - `500` `{ "error": "Error interno" }`.
- **Rate limit**: 120 requests/minuto por key (best-effort).

## Endpoints

### `GET /api/v1/clientes`
Lista de clientes.

Query: `page`, `limit`, `search` (matchea nombre/teléfono/email).

Campos: `id, nombre, telefono, email, direccion, dni, tipo_cliente, razon_social, cuit, tipo_precio, descuento_pct, created_at`.

`tipo_precio` es `"MINORISTA"` o `"MAYORISTA"`. `descuento_pct` es el % negociado (0-100) cuando el cliente es mayorista, `null` en caso contrario.

### `GET /api/v1/ordenes`
Lista de órdenes de servicio.

Query: `page`, `limit`, `estado`.

Campos: `id, numero_orden, codigo_orden, estado, dispositivo, tipo_dispositivo, marca, problema_reportado, presupuesto, costo_final, cliente_id, tecnico_id, fecha_ingreso, fecha_prometida, fecha_completado, created_at`.

> No se exponen datos sensibles (clave del dispositivo, tokens públicos, notas internas).

### `GET /api/v1/inventario`
Lista de ítems de inventario.

Query: `page`, `limit`, `search` (nombre/código), `categoria`, `tipoDispositivo`.

Campos: `id, codigo, nombre, descripcion, categoria, tipo_dispositivo, stock, precio_venta, created_at`.

## Ejemplos (curl)

```bash
# Clientes
curl -H "Authorization: Bearer stapp_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  "https://mitaller.stapp.com.ar/api/v1/clientes?page=1&limit=50"

# Órdenes en reparación
curl -H "Authorization: Bearer stapp_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  "https://mitaller.stapp.com.ar/api/v1/ordenes?estado=EN_REPARACION"

# Inventario por categoría
curl -H "Authorization: Bearer stapp_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  "https://mitaller.stapp.com.ar/api/v1/inventario?categoria=Pantallas&search=iphone"
```

## Notas

- v1 es **read-only**. La escritura (crear/actualizar) llegará en una versión futura.
- El rate limit es por instancia (best-effort); para integraciones de alto volumen, paginá con `limit=100` y espaciá las llamadas.
- Para recibir eventos en tiempo real (push), usá los **webhooks salientes** (Configuración → Webhooks) en lugar de hacer polling.
