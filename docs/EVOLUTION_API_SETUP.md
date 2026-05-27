# Evolution API — WhatsApp self-hosted

Alternativa a Meta Cloud API. Conecta como WhatsApp Web (Baileys). Sin aprobacion
de templates, sin costos por mensaje, pero **no oficial** — Meta puede banear el
numero si detecta uso abusivo.

## Cuando usar Evolution vs Meta

| Caso | Provider |
|---|---|
| Volumen alto, cliente serio, mensajes a numeros frios | Meta Cloud (BSP) |
| Volumen bajo, presupuesto cero, conversaciones con clientes ya conocidos | Evolution |
| Necesitas templates aprobados, ventana 24h, deliverability oficial | Meta Cloud |
| Querias automatizar pero no queres papeleo Meta ni costos | Evolution |

## Self-host Evolution

Docker compose minimo:

```yaml
version: "3"
services:
  evolution:
    image: atendai/evolution-api:latest
    container_name: evolution_api
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      AUTHENTICATION_API_KEY: "CHANGE_ME_LONG_RANDOM_STRING"
      AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: "true"
      DATABASE_ENABLED: "true"
      DATABASE_PROVIDER: "postgresql"
      DATABASE_CONNECTION_URI: "postgresql://user:pass@db:5432/evolution"
      DATABASE_SAVE_DATA_INSTANCE: "true"
      DATABASE_SAVE_DATA_NEW_MESSAGE: "true"
      DATABASE_SAVE_MESSAGE_UPDATE: "true"
      DATABASE_SAVE_DATA_CONTACTS: "true"
      DATABASE_SAVE_DATA_CHATS: "true"
      CONFIG_SESSION_PHONE_CLIENT: "STApp"
      QRCODE_LIMIT: "30"
    volumes:
      - evolution_instances:/evolution/instances
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: evolution
    volumes:
      - evolution_db:/var/lib/postgresql/data

volumes:
  evolution_instances:
  evolution_db:
```

Levantar:

```bash
docker compose up -d
```

Verificar:

```bash
curl -H "apikey: TU_API_KEY" http://localhost:8080/instance/fetchInstances
```

## Configuracion en STApp

1. Configuracion &gt; WhatsApp.
2. Tab **Evolution API**.
3. URL del servidor: `https://evo.tudominio.com` (https obligatorio si expones
   publico).
4. Nombre de instancia: identificador unico por organizacion, ej `stapp-org-abc123`.
5. API key: el valor de `AUTHENTICATION_API_KEY` del docker-compose.
6. Guardar y crear instancia.
7. Click **Pedir QR**. Abri WhatsApp en el telefono &gt; Dispositivos
   vinculados &gt; Vincular dispositivo. Escanear.
8. Esperar que estado pase a `open`. El polling es automatico cada 4s mientras
   este la pagina abierta.

## Limites recomendados

Para minimizar riesgo de ban:

- Numero dedicado, no personal.
- Calentar el numero: primeros dias 20-50 mensajes/dia, subir gradualmente.
- Maximo 300-500 mensajes/dia por numero "calentado".
- No enviar a numeros que no tengan el tuyo guardado, o que nunca te escribieron.
- Variar el contenido (no spam identico).
- Respetar opt-outs.

## Webhooks (opcional, para recibir respuestas)

Configurar el webhook en Evolution apuntando a `/api/whatsapp/webhook` (mismo
endpoint que Meta — habria que adaptarlo para Evolution si se quieren recibir
mensajes entrantes). Por ahora la integracion es solo envio.

## Variables de entorno requeridas

Las mismas que Meta:

```bash
WHATSAPP_ENCRYPTION_KEY=<random-32-bytes-hex>
```

Se reutiliza para encriptar la API key de Evolution.

## Troubleshooting

**Estado queda en `connecting` y no avanza:**
QR expiro. Pedir uno nuevo.

**`HTTP 401` al crear instancia:**
API key incorrecta o header `apikey` mal seteado.

**`HTTP 403` o "instance already exists":**
Normal. El config route trata esos casos como exito.

**Mensajes no llegan pero state=open:**
- Verificar formato del numero destino (Argentina: 54 + area + numero, sin 15).
- Probar enviar manualmente desde el endpoint Evolution:
  ```bash
  curl -X POST "https://evo.tudominio.com/message/sendText/INSTANCIA" \
    -H "apikey: TU_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"number":"5491155667788","text":"hola"}'
  ```

**El numero fue baneado:**
Whatsapp banea por uso anormal. No hay apelacion rapida. Soluciones:
- Usar otro numero.
- Migrar a Meta Cloud API (BSP) para volumen alto.
