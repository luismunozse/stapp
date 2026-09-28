# Evolution API en Hetzner Cloud (producción)

Servidor Evolution de producción de STApp: `https://evo.stapp.com.ar`. Se armó en Hetzner porque Oracle ARM no tenía cupo ("Out of capacity"); `whatsapp-evolution-oracle-deploy.md` queda como alternativa gratuita.

La diferencia principal con el doc de Oracle: el HTTPS lo pone **Caddy**, dentro del mismo compose, con los puertos 80 y 443 abiertos. **No hay Cloudflare Tunnel.**

---

## Cómo está armado hoy

| | |
|---|---|
| Server | `ubuntu-4gb-hel1-1` en la consola de Hetzner: **CX23** (x86, 2 vCPU, 4 GB, 40 GB), Helsinki |
| Dominio | `evo.stapp.com.ar`: registro A directo a la IP del server, sin proxy de Cloudflare |
| Stack | `/root/evolution/docker-compose.yml` (proyecto `evolution`) |
| Acceso | `ssh root@evo.stapp.com.ar`, solo con clave SSH |

| Servicio | Imagen | Puertos |
|---|---|---|
| `evolution-api` | `atendai/evolution-api:v2.1.1` | `127.0.0.1:8080`, solo local |
| `caddy` | `caddy:2-alpine` | `80` y `443`, públicos |
| `postgres` | `postgres:16-alpine` | interno |
| `redis` | `redis:7-alpine` | interno |

Caddy recibe el tráfico de `evo.stapp.com.ar` y se lo pasa a `evolution-api`; los demás contenedores no quedan expuestos. STApp se conecta con `EVOLUTION_BASE_URL=https://evo.stapp.com.ar` y `EVOLUTION_API_KEY` (el `AUTHENTICATION_API_KEY` del compose) en las variables de entorno de Vercel. Cada taller solo escanea su QR.

La copia que vale del compose es la del server. La receta de "Armarlo de cero" es para reconstruirlo si el server se pierde.

---

## Acceso

```bash
ssh root@evo.stapp.com.ar
```

- Se entra **solo con clave SSH**. No dependas de la contraseña de root.
- Huella del server (ED25519): `SHA256:zUvFLMUUFsrsYOE803Lo1cp9dAankCjQd5KaoqqTWas`. Si al conectarte aparece otra, estás en el modo rescate o el server cambió.
- Guardá una copia de la clave privada (`~/.ssh/id_ed25519`) en un gestor de contraseñas. Si se pierde, la única vuelta es el modo rescate.

### Si perdiste la clave

Así se recuperó el acceso el 2026-09-28. Mientras el server está en modo rescate, Evolution queda caído (unos minutos).

1. En tu PC, generá una clave nueva. Si ya tenés un `id_ed25519` que usás para otra cosa (GitHub, otro server), no lo pises: generala con otro nombre (`-f`) y conectate con `ssh -i`.
   ```
   ssh-keygen -t ed25519
   ```
2. Hetzner → **Security → SSH keys → Add SSH key**: pegá la pública (`id_ed25519.pub`).
3. Server → **Rescue → Enable rescue & power cycle**, con `linux64` y esa clave. Tiene que ser la opción con *power cycle*: sin el reinicio, el server sigue en el Ubuntu normal.
4. Entrá al rescate. El prompt dice `root@rescue` y la huella es distinta de la de arriba:
   ```
   ssh-keygen -R evo.stapp.com.ar
   ssh root@evo.stapp.com.ar
   ```
5. Copiá la clave al disco del server y reiniciá:
   ```bash
   mount /dev/sda1 /mnt
   mkdir -p /mnt/root/.ssh
   echo 'ssh-ed25519 AAAA...tu-clave-publica' >> /mnt/root/.ssh/authorized_keys
   chmod 700 /mnt/root/.ssh; chmod 600 /mnt/root/.ssh/authorized_keys
   umount /mnt
   reboot
   ```
6. El rescate se desactiva solo. Cuando el server vuelva: `ssh-keygen -R evo.stapp.com.ar` y `ssh root@evo.stapp.com.ar`.

---

## Operación

```bash
cd /root/evolution
docker compose ps                            # los 4 contenedores tienen que estar Up
docker compose logs --tail 50 evolution-api
```

- **Cambiar una variable**: `cp docker-compose.yml docker-compose.yml.bak`, editá y corré `docker compose up -d`. Recrea solo el contenedor que cambió. Después confirmá en STApp (Configuración → WhatsApp) que siga conectado.
- **`DATABASE_SAVE_DATA_NEW_MESSAGE=true` es obligatoria**: con `false`, los reintentos de WhatsApp le llegan vacíos al cliente (ver el troubleshooting de `whatsapp-evolution-oracle-deploy.md`). Se corrigió el 2026-09-28.
- **Firewall**: si activás el de Hetzner, abrí TCP **22** (SSH), **80** y **443** (Caddy). Con solo el 22, `evo.stapp.com.ar` deja de responder y se cortan todos los WhatsApp automáticos.
- **Actualizar Evolution**: cambiá el tag de la imagen (siempre fijo, nunca `latest`), corré `docker compose pull && docker compose up -d` y verificá que la sesión sobreviva.
- **Backups**: Hetzner Backups o snapshots manuales. La sesión de WhatsApp vive en los volúmenes de Docker (`docker volume ls`); si el server muere sin backup, hay que reescanear el QR.
- **Costo**: fijo mientras el server exista; apagarlo no ahorra. El precio vigente está en la consola de Hetzner.
- **Riesgo de baneo**: Evolution es WhatsApp no oficial. Para volumen comercial, evaluá **Meta Cloud API** (oficial); STApp ya lo soporta.

---

## Armarlo de cero

1. **Server**: Hetzner Cloud → **Add Server** → Ubuntu LTS, tipo **CX23** (x86, 2 vCPU / 4 GB / 40 GB) o equivalente, cualquier location (hoy es Helsinki). Cargá tu clave SSH al crearlo.
2. **Docker**: Parte 2 de `whatsapp-evolution-oracle-deploy.md`. Como entrás como `root`, salteá el `usermod -aG docker` / `newgrp`.
3. **Compose**: el de la Parte 3 del doc de Oracle, en `/root/evolution/docker-compose.yml`, con `SERVER_URL=https://evo.stapp.com.ar`, `DATABASE_SAVE_DATA_NEW_MESSAGE=true`, una `AUTHENTICATION_API_KEY` real (`openssl rand -hex 32`) y una contraseña real en lugar de `evopass`. Además, agregá Caddy dentro de `services:`:

   ```yaml
     caddy:
       image: caddy:2-alpine
       restart: always
       depends_on:
         - evolution-api
       ports:
         - "80:80"
         - "443:443"
       volumes:
         - ./Caddyfile:/etc/caddy/Caddyfile:ro
         - caddy_data:/data        # certificados HTTPS: no lo pierdas
         - caddy_config:/config
   ```

   Sumá `caddy_data:` y `caddy_config:` a la lista `volumes:` del final. Al lado del compose, el `Caddyfile`:

   ```
   evo.stapp.com.ar {
   	reverse_proxy evolution-api:8080
   }
   ```

   Caddy saca y renueva solo el certificado HTTPS.
4. **DNS y firewall**: registro A de `evo.stapp.com.ar` a la IP nueva (como hoy, sin proxy de Cloudflare) y los puertos 22, 80 y 443 abiertos.
5. **Levantar y probar**:
   ```bash
   cd /root/evolution && docker compose up -d
   curl -s https://evo.stapp.com.ar/instance/fetchInstances -H "apikey: TU_API_KEY"
   ```
   Tiene que devolver JSON (`[]` en un server nuevo), no un error de auth.
6. **STApp**: si cambió la API key, actualizá `EVOLUTION_API_KEY` en Vercel. Cada taller vuelve a escanear su QR en Configuración → WhatsApp.
