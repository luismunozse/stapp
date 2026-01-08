# Configuración de MercadoPago para Argentina

Esta guía te ayudará a configurar MercadoPago como método de pago en tu aplicación STApp.

## ¿Por qué MercadoPago y no Stripe?

**Stripe no está disponible en Argentina**. MercadoPago es la solución de pagos líder en Latinoamérica y ofrece:

- ✅ Disponible en Argentina y toda Latinoamérica
- ✅ Múltiples métodos de pago (tarjeta, efectivo, débito)
- ✅ Integración con bancos argentinos
- ✅ Procesamiento en pesos argentinos (ARS)
- ✅ Sin comisiones internacionales

## Paso 1: Crear una cuenta de MercadoPago

1. Ve a [https://www.mercadopago.com.ar](https://www.mercadopago.com.ar)
2. Registra una cuenta como **vendedor**
3. Completa la verificación de identidad
4. Activa tu cuenta para recibir pagos

## Paso 2: Crear una aplicación

1. Ingresa al [Panel de Desarrolladores](https://www.mercadopago.com.ar/developers/panel)
2. Ve a **"Tus aplicaciones"** → **"Crear aplicación"**
3. Completa los datos:
   - **Nombre**: STApp Suscripciones
   - **Descripción**: Sistema de gestión de taller técnico
   - **Modelo de integración**: Marketplace o Comercio electrónico
4. Guarda la aplicación

## Paso 3: Obtener credenciales

En el panel de tu aplicación, encontrarás:

### Credenciales de Prueba (TEST)

- **Public Key**: Comienza con `TEST-...`
- **Access Token**: Comienza con `TEST-...`

### Credenciales de Producción (PROD)

- **Public Key**: Comienza con `APP_USR-...`
- **Access Token**: Comienza con `APP_USR-...`

## Paso 4: Configurar en tu aplicación

Edita el archivo `.env` y reemplaza los valores:

```bash
# Para ambiente de prueba (TEST)
MERCADOPAGO_ACCESS_TOKEN="TEST-1234567890-123456-abcdef..."
NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY="TEST-12345678-1234-1234-1234-123456789012"
MERCADOPAGO_WEBHOOK_SECRET="tu_webhook_secret_aleatorio"

# Para producción (PROD), usa las credenciales reales
# MERCADOPAGO_ACCESS_TOKEN="APP_USR-1234567890-123456-abcdef..."
# NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY="APP_USR-12345678-1234-1234-1234-123456789012"
```

## Paso 5: Configurar Webhooks (Notificaciones)

Los webhooks son necesarios para que MercadoPago te notifique cuando se completa un pago.

1. En el panel de MercadoPago, ve a **Webhooks**
2. Crea un nuevo webhook con la URL:
   ```
   https://tu-dominio.com/api/mercadopago/webhook
   ```
3. Selecciona los eventos:
   - ✅ `payment` - Pagos
   - ✅ `merchant_order` - Órdenes
4. Copia el **Webhook Secret** y agrégalo al `.env`

### URL del Webhook según ambiente

**Desarrollo local:**
```
https://tu-ngrok-url.ngrok.io/api/mercadopago/webhook
```

**Producción (Vercel):**
```
https://tu-dominio.vercel.app/api/mercadopago/webhook
```

**Dominio propio:**
```
https://stapp.com.ar/api/mercadopago/webhook
```

## Paso 6: Probar la integración

### Modo TEST

1. Asegúrate de estar usando credenciales TEST
2. Ve a la aplicación y haz clic en **"Actualizar a Premium"**
3. Selecciona un plan (mensual o anual)
4. Completa el pago con [tarjetas de prueba de MercadoPago](https://www.mercadopago.com.ar/developers/es/docs/checkout-api/testing)

#### Tarjetas de prueba comunes

| Tarjeta | Número | CVV | Fecha | Resultado |
|---------|--------|-----|-------|-----------|
| Visa | 4509 9535 6623 3704 | 123 | 11/25 | Aprobado ✅ |
| Mastercard | 5031 7557 3453 0604 | 123 | 11/25 | Aprobado ✅ |
| Visa | 4074 5957 2059 5149 | 123 | 11/25 | Rechazado ❌ |

### Modo PRODUCCIÓN

1. Reemplaza las credenciales TEST por las de PRODUCCIÓN
2. Reinicia la aplicación
3. Realiza una compra real

## Paso 7: Verificar pagos

Los pagos se pueden verificar en:

1. **Panel de MercadoPago**: [https://www.mercadopago.com.ar/activities](https://www.mercadopago.com.ar/activities)
2. **Base de datos de tu app**: Tabla `subscriptions`
3. **Logs de la aplicación**: Verifica los webhooks recibidos

## Precios configurados

Los precios están definidos en `lib/mercadopago.ts`:

```typescript
MONTHLY: $14.999 ARS por mes
YEARLY: $143.990 ARS por año (ahorro del 20%)
```

Para cambiar los precios, edita el archivo `lib/mercadopago.ts`:

```typescript
export const MP_PRICES = {
  MONTHLY: {
    amount: 1499900, // $14.999 ARS (en centavos)
    currency: "ARS",
  },
  YEARLY: {
    amount: 14399000, // $143.990 ARS (en centavos)
    currency: "ARS",
  },
}
```

## Solución de problemas

### Error: "MERCADOPAGO_ACCESS_TOKEN not configured"

- Verifica que el `.env` tenga la variable `MERCADOPAGO_ACCESS_TOKEN`
- Reinicia el servidor después de editar `.env`

### El webhook no se ejecuta

- Verifica que la URL del webhook sea accesible públicamente
- En desarrollo local, usa [ngrok](https://ngrok.com/) para exponer tu servidor
- Verifica los logs en el panel de MercadoPago → Webhooks

### El pago se aprueba pero la suscripción no se activa

- Revisa los logs de la aplicación para ver si hay errores en el webhook
- Verifica que el webhook esté configurado correctamente
- Confirma que el `MERCADOPAGO_WEBHOOK_SECRET` sea correcto

### Diferencia entre modo TEST y PRODUCCIÓN

| Aspecto | TEST | PRODUCCIÓN |
|---------|------|------------|
| Credenciales | Comienzan con `TEST-` | Comienzan con `APP_USR-` |
| Dinero real | ❌ No se cobra | ✅ Sí se cobra |
| Tarjetas | Solo tarjetas de prueba | Tarjetas reales |
| Notificaciones | Se envían igual | Se envían igual |

## Links útiles

- [Documentación oficial de MercadoPago](https://www.mercadopago.com.ar/developers)
- [Panel de desarrolladores](https://www.mercadopago.com.ar/developers/panel)
- [Tarjetas de prueba](https://www.mercadopago.com.ar/developers/es/docs/checkout-api/testing)
- [Gestión de webhooks](https://www.mercadopago.com.ar/developers/panel/webhooks)
- [Actividad de pagos](https://www.mercadopago.com.ar/activities)

## Soporte

Si tienes problemas con la integración:

1. Revisa los logs de la aplicación
2. Consulta la documentación oficial de MercadoPago
3. Contacta al soporte de MercadoPago: [https://www.mercadopago.com.ar/ayuda](https://www.mercadopago.com.ar/ayuda)

---

**Nota**: Esta aplicación usa MercadoPago exclusivamente porque **Stripe no está disponible en Argentina**. No intentes configurar Stripe ya que no funcionará para usuarios argentinos.
