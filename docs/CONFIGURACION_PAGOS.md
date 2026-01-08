# Guía de Configuración de MercadoPago

Esta guía te ayudará a configurar MercadoPago para aceptar pagos de suscripciones Premium.

---

## 1️⃣ Crear cuenta en MercadoPago

1. Ve a [https://www.mercadopago.com.ar](https://www.mercadopago.com.ar) (o tu país)
2. Crea tu cuenta o inicia sesión
3. Ve a [https://www.mercadopago.com.ar/developers](https://www.mercadopago.com.ar/developers)

## 2️⃣ Crear una aplicación

1. En el panel de desarrolladores, click en "Tus aplicaciones"
2. Click en "Crear aplicación"
3. Nombre: `STApp Suscripciones`
4. Selecciona "Pagos online"
5. Click "Crear aplicación"

## 3️⃣ Obtener las credenciales

1. Dentro de tu aplicación, ve a la pestaña "Credenciales"
2. Asegúrate de estar en modo **"Pruebas"** (para testing)
3. Copia las siguientes claves:
   - **Public Key**: Comienza con `TEST-...` o `APP_USR-...`
   - **Access Token**: Comienza con `TEST-...` o `APP_USR-...`

⚠️ **IMPORTANTE**: Para producción, cambia a modo "Producción" arriba.

## 4️⃣ Configurar Webhooks (IPN)

1. En tu aplicación, ve a "Webhooks" o "Notificaciones IPN"
2. URL del webhook: `https://TU-DOMINIO.com/api/mercadopago/webhook`
3. Selecciona estos eventos:
   - `payment`
   - `subscription_preapproval`
4. **Copia el Webhook Secret** (puede estar en Configuración > Credenciales)

## 5️⃣ Agregar las claves al .env

```env
# MERCADOPAGO
MERCADOPAGO_ACCESS_TOKEN="TEST-xxxxxxxxxxxxx"
NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY="TEST-xxxxxxxxxxxxx"
MERCADOPAGO_WEBHOOK_SECRET="tu-secret-aqui"
```

---

## 6️⃣ Probar la integración

### Modo Test de MercadoPago

Usuarios de prueba: [https://www.mercadopago.com.ar/developers/panel/test-users](https://www.mercadopago.com.ar/developers/panel/test-users)

Tarjetas de prueba: [https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/test-cards](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/test-cards)

---

## 7️⃣ Webhooks en desarrollo local

### Usando ngrok

```bash
# Instalar ngrok: https://ngrok.com/download

# Iniciar túnel
ngrok http 3000

# Usar la URL HTTPS que te da ngrok en la configuración de webhooks
# Ejemplo: https://abc123.ngrok.io/api/mercadopago/webhook
```

---

## 8️⃣ Pasar a producción

1. Completa la verificación de tu cuenta
2. En "Credenciales", cambia a modo "Producción"
3. Copia las credenciales de producción
4. Actualiza el webhook con tu dominio real
5. Actualiza las variables en `.env` con las claves de producción

---

## 🆘 Troubleshooting

### Error MercadoPago: "Invalid credentials"
- Verifica que estés usando las credenciales correctas (Test/Producción)
- El Access Token debe empezar con `TEST-` o `APP_USR-`

### Pagos no se reflejan en el sistema
- Verifica que los webhooks estén configurados
- Revisa los logs en Dashboard > Webhooks
- Verifica que la URL del webhook sea accesible públicamente

---

## 📚 Recursos adicionales

- [Documentación MercadoPago](https://www.mercadopago.com.ar/developers/es/docs)
- [MercadoPago Checkout Pro](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/landing)
- [Suscripciones MercadoPago](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/landing)
