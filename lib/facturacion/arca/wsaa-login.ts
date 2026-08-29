/**
 * Puente entre el ticket WSAA que STApp persiste en `wsaa_tickets`
 * (migración 298) y `@arcasdk/core`.
 *
 * POR QUE NO SE USA EL `ticketStorage` DEL SDK
 *
 * El SDK acepta un `ITicketStoragePort`, pero cuando ese puerto devuelve
 * `null` es el SDK el que hace el login WSAA. Ese camino no pasa por nuestro
 * lease (`lib/facturacion/arca/lease.ts`), así que dos ejecuciones
 * concurrentes — dos cold starts de Vercel, por ejemplo — dispararían dos
 * logins simultáneos y AFIP responde `coe.alreadyAuthenticated`, dejando a la
 * org sin poder facturar hasta que expire el TA (12 h).
 *
 * Por eso STApp se queda con el ciclo de vida completo del ticket
 * (`renewWsaaTicket`: doble lectura + lease + piso anti-tight-loop) y le
 * inyecta el resultado al SDK como `credentials` + `handleTicket: true`. En
 * ese modo `AuthRepository.login()` devuelve el ticket sin tocar la red.
 */

import { AuthRepository } from "@arcasdk/core"
import type { ArcaServiceName, ILoginCredentials } from "@arcasdk/core"
import type { WsaaTicket } from "@/lib/facturacion/arca/wsaa-ticket-store"

/**
 * `LoginTicketHeaders` es la tupla `[{version}, {source, destination,
 * uniqueid, generationtime, expirationtime}]` que AFIP devuelve en el
 * loginTicketResponse. De todo eso, lo único que el SDK consume es
 * `expirationtime` (lo valida `AccessTicket.validate()` y lo lee
 * `getExpiration()`/`isExpired()`); el request al WSFE solo lleva
 * `Auth: {Token, Sign, Cuit}`.
 *
 * `wsaa_tickets` guarda token/sign/expires_at/generated_at, no el header
 * crudo, así que el resto de los campos se completan vacíos a propósito: no
 * se inventan valores que parezcan de AFIP.
 */
export function toLoginCredentials(ticket: WsaaTicket): ILoginCredentials {
  return {
    header: [
      { version: "1.0" },
      {
        source: "",
        destination: "",
        uniqueid: "",
        generationtime: ticket.generatedAt ?? ticket.expiresAt,
        expirationtime: ticket.expiresAt,
      },
    ],
    credentials: {
      token: ticket.token,
      sign: ticket.sign,
    },
  }
}

/** Lo que `renewWsaaTicket` espera de un login: los tres campos que persiste. */
export interface WsaaLoginResult {
  token: string
  sign: string
  /** ISO 8601 — `expirationtime` del header devuelto por AFIP. */
  expiresAt: string
}

export interface WsaaLoginParams {
  /**
   * CUIT del certificado. `AuthRepositoryConfig` lo exige, pero NO participa
   * del login: el TRA se firma solo con cert/key y AFIP deriva la identidad
   * del subject del certificado (ver `auth.repository.ts#signTRA`).
   */
  cuit: string
  /** PEM del certificado de STApp (ya descifrado). */
  certPem: string
  /** PEM de la clave privada de STApp (ya descifrada). */
  keyPem: string
  production: boolean
  service: ArcaServiceName
}

/** Superficie mínima que usamos de `AccessTicket` — inyectable en tests. */
interface AccessTicketLike {
  getToken(): string
  getSign(): string
  getExpiration(): Date
}

interface AuthRepositoryLike {
  requestLogin(service: ArcaServiceName): Promise<AccessTicketLike>
}

export interface WsaaLoginDeps {
  createAuthRepository?: (config: {
    cert: string
    key: string
    cuit: number
    production: boolean
  }) => AuthRepositoryLike
}

/**
 * Ejecuta el login WSAA contra AFIP y devuelve el ticket en la forma que
 * persiste `wsaa_tickets`.
 *
 * Se llama `requestLogin` y no `login` a propósito: `login()` primero
 * consulta el `ticketStorage` del SDK, y acá ya venimos de la doble lectura
 * de `renewWsaaTicket` con el lease tomado — la decisión de pedir un ticket
 * nuevo ya está hecha. Esta función NUNCA debe invocarse fuera de ese lease:
 * dos logins concurrentes para el mismo certificado terminan en
 * `coe.alreadyAuthenticated` y dejan a la org sin facturar hasta 12 h.
 */
export async function wsaaLogin(
  params: WsaaLoginParams,
  deps: WsaaLoginDeps = {}
): Promise<WsaaLoginResult> {
  const createAuthRepository =
    deps.createAuthRepository ?? ((config) => new AuthRepository(config) as AuthRepositoryLike)

  const repository = createAuthRepository({
    cert: params.certPem,
    key: params.keyPem,
    cuit: Number(params.cuit),
    production: params.production,
  })

  const ticket = await repository.requestLogin(params.service)

  return {
    token: ticket.getToken(),
    sign: ticket.getSign(),
    expiresAt: ticket.getExpiration().toISOString(),
  }
}
