import { randomUUID } from 'node:crypto'

import { enlaceVerificacionWhatsapp, enmascararTelefono, normalizarTelefono, telefonoDesdeWaId, waIdEquivalentes, type MotivoTelefonoInvalido } from '@factory/contracts'

import { AUTH_EVENT_KIND } from '../domain/constants.js'
import type { Account, SecurityEvent } from '../domain/models.js'
import type { AuditSink, RateLimiter } from '../ports/security.js'
import {
  MAX_INTENTOS_FALLIDOS,
  TTL_DESAFIO_MS,
  esMensajeVerificacion,
  extraerCodigo,
  generarCodigoDesafio,
  generarSecretoConsulta,
  hashDesafio,
  hashSecretoConsulta,
} from './desafio.ts'
import type { AlmacenTelefonos, DesafioTelefono, PropositoDesafio, ResultadoVinculoWhatsapp } from './puertos.ts'

// Phone-first identity: verification INITIATED BY THE USER from WhatsApp (no outbound OTP, no
// authentication template). TUS creates a challenge, the Web opens WhatsApp with
// "VERIFICAR TUS <code>" written, the person taps Enviar, the signed Meta webhook delivers the
// message, and the phone is verified only if the SENDER (wa_id, from Meta, never from the Web) is
// the number the challenge expects. The WhatsApp answer is deterministic text (no LLM) and its
// delivery never decides the verification.

export type EstadoDesafioWhatsapp = 'ninguno' | 'pendiente' | 'vencido' | 'usado' | 'invalidado'
export type EstadoNumeroWhatsapp = 'sin_cuenta' | 'verificado_sin_vinculo' | 'desafio_pendiente' | 'vinculado' | 'conflicto'

export const RESPUESTAS_VERIFICACION = {
  // The number was proved AND this WhatsApp is linked to the account: said only after the commit.
  vinculado: '✅ ¡Listo! Este WhatsApp quedó vinculado a tu cuenta TUS.\n\nYa podés buscar profesionales, consultar tus turnos, verificar pagos y usar TUS directamente desde acá.',
  // Only when no linker is wired (never in the API): the phone is verified, nothing is linked.
  verificado: '✅ Tu número quedó verificado en TUS. Ya podés volver a la aplicación.',
  vinculoOcupado: 'Este WhatsApp ya está vinculado a otra cuenta TUS, así que no lo vinculé. Si es tu número, desvinculalo desde esa cuenta y volvé a intentarlo.',
  recuperacion: '✅ Confirmamos tu número. Volvé a TUS para elegir tu nueva contraseña.',
  invalido: 'No pudimos verificar ese código. Volvé a TUS y generá una nueva verificación.',
} as const

export type ResultadoVerificacionWhatsapp =
  | { resultado: 'verificado' | 'vinculado' | 'recuperacion' | 'vinculo_ocupado'; desafioId: string; respuesta: string }
  | { resultado: 'invalido'; desafioId: string | null; respuesta: string }
  // The same Meta message again (webhook retry): nothing happens and nothing is sent twice.
  | { resultado: 'repetido'; desafioId: string; respuesta: null }

export type ErrorTelefono =
  | { ok: false; code: 'INVALID_PHONE'; motivo: MotivoTelefonoInvalido }
  | { ok: false; code: 'RATE_LIMITED' | 'ALREADY_VERIFIED' | 'PHONE_NOT_VERIFIED' | 'ALREADY_LINKED' | 'ACCOUNT_NOT_ALLOWED' | 'NOT_FOUND' | 'UNAVAILABLE' }

export interface DesafioCreado {
  challengeId: string
  code: string
  purpose: PropositoDesafio
  phoneMasked: string
  expiresAt: string
  whatsappUrl: string | null
  message: string
}

export interface EstadoDesafio {
  status: 'pending' | 'verified' | 'expired' | 'failed'
  purpose: PropositoDesafio | null
  phoneMasked: string | null
  // Password recovery only: a normal single-use recovery token, handed over ONCE.
  recoveryToken?: string
}

export interface DependenciasTelefono {
  telefonos: AlmacenTelefonos
  cuentas: { getAccount(accountId: string): Promise<Account | undefined> }
  audit: AuditSink
  now: () => number
  // The official TUS WhatsApp number (public, e.g. "+5493794000000"). Null: the Web shows the
  // code to send manually and the flow still works.
  numeroOficial: string | null
  limitadores?: { porCuenta?: RateLimiter; porTelefono?: RateLimiter; porIp?: RateLimiter; recuperacion?: RateLimiter }
  // Issues a normal password recovery token for the account (same table and completion endpoint
  // as the email recovery): returns the raw token once.
  emitirTokenRecuperacion?: (accountId: string) => Promise<string>
}

class ConflictoTelefono extends Error {}
class ConflictoVinculo extends Error {}

// The challenge as the HTTP layer returns it (without the internal `ok` flag).
export function vistaDesafio<T extends { ok: true }>(valor: T): Omit<T, 'ok'> {
  const copia: Partial<T> = { ...valor }
  delete copia.ok
  return copia as Omit<T, 'ok'>
}

export class ServicioVerificacionTelefono {
  constructor(private readonly deps: DependenciasTelefono) {}

  get numeroOficial(): string | null {
    return this.deps.numeroOficial
  }

  private enlace(codigo: string): string | null {
    return this.deps.numeroOficial ? enlaceVerificacionWhatsapp(this.deps.numeroOficial, codigo) : null
  }

  private async permitido(limitador: RateLimiter | undefined, clave: string) {
    return !limitador || (await limitador.allow(clave, this.deps.now()))
  }

  private async auditar(kind: SecurityEvent['kind'], cuenta: { id: string; tenantId: string } | null, outcome: SecurityEvent['outcome'], metadata: SecurityEvent['metadata'], actorId?: string) {
    await this.deps.audit.record({
      contractVersion: '1.0.0',
      kind,
      occurredAt: new Date(this.deps.now()).toISOString(),
      actorId: actorId ?? cuenta?.id ?? 'whatsapp-webhook',
      tenantId: cuenta?.tenantId ?? 'unknown',
      outcome,
      correlationId: randomUUID(),
      metadata,
    }).catch(() => undefined)
  }

  private async crear(cuenta: Account, telefono: string, purpose: PropositoDesafio, conSecreto: boolean, marcarPendiente = true) {
    const codigo = generarCodigoDesafio()
    const secreto = conSecreto ? generarSecretoConsulta() : null
    const ahora = this.deps.now()
    const desafio: DesafioTelefono = {
      id: `desafio-telefono-${randomUUID()}`,
      accountId: cuenta.id,
      phone: telefono,
      purpose,
      codeHash: hashDesafio(codigo),
      pollSecretHash: secreto ? hashSecretoConsulta(secreto) : null,
      expiresAt: ahora + TTL_DESAFIO_MS,
      usedAt: null,
      invalidatedAt: null,
      invalidationReason: null,
      failedAttempts: 0,
      verifiedWamid: null,
      deliveredAt: null,
      confirmationSentAt: null,
      confirmationError: null,
      createdAt: ahora,
    }
    await this.deps.telefonos.transaccion(async (almacen) => {
      await almacen.crearDesafio(desafio)
      if (purpose !== 'recuperar_contrasena' && marcarPendiente) await almacen.fijarPendiente(cuenta.id, telefono)
    })
    await this.auditar(AUTH_EVENT_KIND.PHONE_CHALLENGE_CREATED, cuenta, 'accepted', { purpose, phone: enmascararTelefono(telefono) })
    return { desafio, codigo, secreto }
  }

  private vista(desafio: DesafioTelefono, codigo: string): DesafioCreado {
    return {
      challengeId: desafio.id,
      code: codigo,
      purpose: desafio.purpose,
      phoneMasked: enmascararTelefono(desafio.phone),
      expiresAt: new Date(desafio.expiresAt).toISOString(),
      whatsappUrl: this.enlace(codigo),
      message: `VERIFICAR TUS ${codigo}`,
    }
  }

  // Signed-in person: verify a first phone or change it. The current identity phone stays until
  // the new one is proved from WhatsApp.
  async iniciar(accountId: string, entrada: { telefono: unknown; ip?: string }): Promise<({ ok: true } & DesafioCreado) | ErrorTelefono> {
    const normalizado = normalizarTelefono(entrada.telefono)
    if (!normalizado.ok) return { ok: false, code: 'INVALID_PHONE', motivo: normalizado.motivo }
    const cuenta = await this.deps.cuentas.getAccount(accountId)
    if (!cuenta || cuenta.status !== 'active') return { ok: false, code: 'ACCOUNT_NOT_ALLOWED' }
    const estado = await this.deps.telefonos.estado(accountId)
    if (estado?.phoneNumber === normalizado.e164) return { ok: false, code: 'ALREADY_VERIFIED' }
    const limites = this.deps.limitadores
    if (!(await this.permitido(limites?.porCuenta, `cuenta:${accountId}`)) || !(await this.permitido(limites?.porTelefono, `telefono:${normalizado.e164}`)) || (entrada.ip && !(await this.permitido(limites?.porIp, `ip:${entrada.ip}`))))
      return { ok: false, code: 'RATE_LIMITED' }
    // A number that belongs to another person is NOT revealed here (same answer); verifying it
    // later fails on the UNIQUE identity phone.
    const purpose: PropositoDesafio = estado?.phoneNumber ? 'cambiar_telefono' : 'verificar_telefono'
    const { desafio, codigo } = await this.crear(cuenta, normalizado.e164, purpose, false)
    return { ok: true, ...this.vista(desafio, codigo) }
  }

  // "Vincular este WhatsApp" from Mi perfil: the account already has a VERIFIED identity phone, so
  // the challenge is for that same number. Sending it from that WhatsApp consumes the challenge and
  // links the contact (see verificarDesdeWhatsapp). The number is never taken from the request.
  async iniciarVinculo(accountId: string, entrada: { ip?: string } = {}): Promise<({ ok: true } & DesafioCreado) | ErrorTelefono> {
    const cuenta = await this.deps.cuentas.getAccount(accountId)
    if (!cuenta || cuenta.status !== 'active') return { ok: false, code: 'ACCOUNT_NOT_ALLOWED' }
    const estado = await this.deps.telefonos.estado(accountId)
    if (!estado?.phoneNumber) return { ok: false, code: 'PHONE_NOT_VERIFIED' }
    if (await this.deps.telefonos.waIdVinculado(accountId)) return { ok: false, code: 'ALREADY_LINKED' }
    const limites = this.deps.limitadores
    if (!(await this.permitido(limites?.porCuenta, `cuenta:${accountId}`)) || (entrada.ip && !(await this.permitido(limites?.porIp, `ip:${entrada.ip}`)))) return { ok: false, code: 'RATE_LIMITED' }
    const { desafio, codigo } = await this.crear(cuenta, estado.phoneNumber, 'verificar_telefono', false, false)
    return { ok: true, ...this.vista(desafio, codigo) }
  }

  // Right after sign-up (no session yet): the page polls with the returned secret.
  // Checked by the sign-up endpoint BEFORE it knows whether the email is new, so the limit never
  // tells an existing account from a new one.
  async permitirRegistro(telefono: string, ip?: string): Promise<boolean> {
    const limites = this.deps.limitadores
    return (await this.permitido(limites?.porTelefono, `telefono:${telefono}`)) && (!ip || (await this.permitido(limites?.porIp, `ip:${ip}`)))
  }

  async iniciarRegistro(accountId: string, telefono: string): Promise<({ ok: true; pollSecret: string } & DesafioCreado) | ErrorTelefono> {
    const cuenta = await this.deps.cuentas.getAccount(accountId)
    if (!cuenta || cuenta.status !== 'active') return { ok: false, code: 'ACCOUNT_NOT_ALLOWED' }
    const { desafio, codigo, secreto } = await this.crear(cuenta, telefono, 'verificar_telefono', true)
    return { ok: true, pollSecret: secreto!, ...this.vista(desafio, codigo) }
  }

  // "Generar un código nuevo" from the waiting page (expired code, message not sent...): the same
  // account, phone and purpose, authorized by the poll secret. Unknown or fake -> another fake.
  async renovar(challengeId: string, pollSecret: unknown, ip?: string): Promise<({ ok: true; pollSecret: string } & DesafioCreado) | ErrorTelefono> {
    const desafio = typeof challengeId === 'string' && challengeId.length <= 80 ? await this.deps.telefonos.desafio(challengeId) : null
    const valido = desafio && typeof pollSecret === 'string' && desafio.pollSecretHash !== null && hashSecretoConsulta(pollSecret) === desafio.pollSecretHash
    const limites = this.deps.limitadores
    const telefono = valido ? desafio.phone : null
    if ((telefono && !(await this.permitido(limites?.porTelefono, `telefono:${telefono}`))) || (ip && !(await this.permitido(limites?.porIp, `ip:${ip}`)))) return { ok: false, code: 'RATE_LIMITED' }
    const cuenta = valido ? await this.deps.cuentas.getAccount(desafio.accountId) : undefined
    const usado = valido && desafio.usedAt !== null && desafio.invalidatedAt === null
    if (!valido || !cuenta || cuenta.status !== 'active' || usado) return this.ficticio(desafio?.phone ?? '+5490000000000', desafio?.purpose ?? 'verificar_telefono')
    const nuevo = await this.crear(cuenta, desafio.phone, desafio.purpose, true)
    return { ok: true, pollSecret: nuevo.secreto!, ...this.vista(nuevo.desafio, nuevo.codigo) }
  }

  // A signed-out person who forgot the password. Same answer whether the phone exists or not
  // (no account enumeration): an unknown phone gets a code that verifies nothing.
  async iniciarRecuperacion(entrada: { telefono: unknown; ip?: string }): Promise<({ ok: true; pollSecret: string } & DesafioCreado) | ErrorTelefono> {
    const normalizado = normalizarTelefono(entrada.telefono)
    if (!normalizado.ok) return { ok: false, code: 'INVALID_PHONE', motivo: normalizado.motivo }
    const limites = this.deps.limitadores
    if (!(await this.permitido(limites?.recuperacion, `telefono:${normalizado.e164}`)) || (entrada.ip && !(await this.permitido(limites?.porIp, `ip:${entrada.ip}`)))) return { ok: false, code: 'RATE_LIMITED' }
    const accountId = await this.deps.telefonos.cuentaPorTelefono(normalizado.e164)
    const cuenta = accountId ? await this.deps.cuentas.getAccount(accountId) : undefined
    if (!cuenta || cuenta.status !== 'active' || !this.deps.emitirTokenRecuperacion) return this.ficticio(normalizado.e164, 'recuperar_contrasena')
    const { desafio, codigo, secreto } = await this.crear(cuenta, normalizado.e164, 'recuperar_contrasena', true)
    return { ok: true, pollSecret: secreto!, ...this.vista(desafio, codigo) }
  }

  // Same shape as a real challenge, stored nowhere: the answer for an unknown phone (recovery) or
  // an already registered email (sign-up), so neither reveals whether an account exists.
  ficticio(telefono: string, purpose: PropositoDesafio): { ok: true; pollSecret: string } & DesafioCreado {
    const codigo = generarCodigoDesafio()
    return {
      ok: true,
      pollSecret: generarSecretoConsulta(),
      challengeId: `desafio-telefono-${randomUUID()}`,
      code: codigo,
      purpose,
      phoneMasked: enmascararTelefono(telefono),
      expiresAt: new Date(this.deps.now() + TTL_DESAFIO_MS).toISOString(),
      whatsappUrl: this.enlace(codigo),
      message: `VERIFICAR TUS ${codigo}`,
    }
  }

  // State for the page that is waiting. Authorized by the session (owner account) or by the
  // poll secret. A poll-secret answer (sign-up, recovery) is only 'pending' or 'verified' and
  // carries nothing else: an unknown or fake challenge looks exactly like a real one that is
  // still waiting, so the answer never reveals whether an account exists. The Web stops
  // waiting by itself when the code expires.
  async estado(challengeId: string, autorizacion: { accountId: string } | { pollSecret: unknown }): Promise<EstadoDesafio | null> {
    const desafio = typeof challengeId === 'string' && challengeId.length <= 80 ? await this.deps.telefonos.desafio(challengeId) : null
    const porSecreto = 'pollSecret' in autorizacion
    const autorizado = desafio && (porSecreto
      ? typeof autorizacion.pollSecret === 'string' && desafio.pollSecretHash !== null && hashSecretoConsulta(autorizacion.pollSecret) === desafio.pollSecretHash
      : desafio.accountId === autorizacion.accountId)
    const oculto: EstadoDesafio = { status: 'pending', purpose: null, phoneMasked: null }
    if (!desafio || !autorizado) return porSecreto ? oculto : null
    const ahora = this.deps.now()
    const verificado = desafio.usedAt !== null && desafio.invalidatedAt === null
    const status: EstadoDesafio['status'] = verificado ? 'verified' : desafio.invalidatedAt !== null ? 'failed' : desafio.expiresAt <= ahora ? 'expired' : 'pending'
    if (!porSecreto) return { status, purpose: desafio.purpose, phoneMasked: enmascararTelefono(desafio.phone) }
    if (!verificado) return oculto
    if (desafio.purpose !== 'recuperar_contrasena') return { ...oculto, status: 'verified' }
    // The recovery authorization is created and handed over a single time.
    if (!this.deps.emitirTokenRecuperacion || !(await this.deps.telefonos.marcarEntregado(desafio.id, ahora))) return { ...oculto, status: 'verified' }
    return { ...oculto, status: 'verified', recoveryToken: await this.deps.emitirTokenRecuperacion(desafio.accountId) }
  }

  // Own phone identity for "Mi cuenta" (masked; the full number is not needed on screen).
  async estadoCuenta(accountId: string) {
    const estado = await this.deps.telefonos.estado(accountId)
    return {
      verified: Boolean(estado?.phoneNumber),
      phoneMasked: estado?.phoneNumber ? enmascararTelefono(estado.phoneNumber) : null,
      verifiedAt: estado?.phoneVerifiedAt ? new Date(estado.phoneVerifiedAt).toISOString() : null,
      pendingMasked: estado?.phonePending ? enmascararTelefono(estado.phonePending) : null,
      // A verified phone and a linked WhatsApp are different facts: the link lives on the assistant's contact.
      whatsappLinked: Boolean(await this.deps.telefonos.waIdVinculado(accountId)),
    }
  }

  // Wording only: whether the sender's number is already a verified identity phone. It never
  // authenticates anyone; linking still needs the challenge.
  async numeroVerificado(waId: string): Promise<boolean> {
    const telefono = telefonoDesdeWaId(waId)
    return telefono !== null && (await this.deps.telefonos.cuentaPorTelefono(telefono)) !== null
  }

  // What the backend knows about the number a WhatsApp message came FROM, for the conversation of
  // that very sender. The only input is the wa_id Meta delivered (never a number somebody typed),
  // read with the canonical phone functions, and the answer is a state: no account, name, email,
  // document or tenant ever leaves here, so it cannot be used to look other people up. It never
  // authenticates anyone and never changes a link: linking still needs the challenge.
  //   sin_cuenta: the number is not the verified phone of an active account.
  //   verificado_sin_vinculo: it is, and that account has no WhatsApp linked yet.
  //   desafio_pendiente: a verification or link challenge for this number is waiting to be sent.
  //   vinculado: the account of this number has this very WhatsApp linked.
  //   conflicto: the account of this number is linked to ANOTHER WhatsApp.
  async estadoNumero(waId: string): Promise<EstadoNumeroWhatsapp> {
    const telefono = telefonoDesdeWaId(waId)
    if (!telefono) return 'sin_cuenta'
    const ahora = this.deps.now()
    const accountId = await this.deps.telefonos.cuentaPorTelefono(telefono)
    const cuenta = accountId ? await this.deps.cuentas.getAccount(accountId) : undefined
    const pendiente = await this.deps.telefonos.desafioVivoPara(telefono, ahora)
    if (!cuenta || cuenta.status !== 'active') return pendiente ? 'desafio_pendiente' : 'sin_cuenta'
    const vinculado = await this.deps.telefonos.waIdVinculado(cuenta.id)
    if (vinculado) return waIdEquivalentes(waId).includes(vinculado) ? 'vinculado' : 'conflicto'
    return pendiente ? 'desafio_pendiente' : 'verificado_sin_vinculo'
  }

  // What happened to the last verification / link code created for the sender's OWN number, so a
  // problem with a code can be explained with its real cause (never an invented one). Like
  // estadoNumero: the only input is the wa_id Meta delivered, and the answer is a state.
  async estadoDesafio(waId: string): Promise<EstadoDesafioWhatsapp> {
    const telefono = telefonoDesdeWaId(waId)
    const desafio = telefono ? await this.deps.telefonos.ultimoDesafioDe(telefono) : null
    if (!desafio) return 'ninguno'
    if (desafio.usedAt !== null) return 'usado'
    if (desafio.invalidatedAt !== null) return 'invalidado'
    return desafio.expiresAt <= this.deps.now() ? 'vencido' : 'pendiente'
  }

  esMensajeVerificacion(texto: unknown): boolean {
    return esMensajeVerificacion(texto)
  }

  // Called by the WhatsApp webhook AFTER the Meta signature was verified. `waId` is the sender
  // Meta reports (the only phone this trusts); `wamid` makes a redelivery harmless.
  async verificarDesdeWhatsapp(entrada: { waId: string; texto: string; wamid: string }): Promise<ResultadoVerificacionWhatsapp> {
    const invalido = (desafioId: string | null = null): ResultadoVerificacionWhatsapp => ({ resultado: 'invalido', desafioId, respuesta: RESPUESTAS_VERIFICACION.invalido })
    const codigo = extraerCodigo(entrada.texto)
    const remitente = telefonoDesdeWaId(entrada.waId)
    if (!codigo || !remitente) return invalido()
    const desafio = await this.deps.telefonos.desafioPorHash(hashDesafio(codigo))
    if (!desafio) return invalido()
    if (desafio.verifiedWamid === entrada.wamid) return { resultado: 'repetido', desafioId: desafio.id, respuesta: null }
    const ahora = this.deps.now()
    const cuenta = await this.deps.cuentas.getAccount(desafio.accountId)
    if (!cuenta || desafio.usedAt !== null || desafio.invalidatedAt !== null || desafio.expiresAt <= ahora) return invalido(desafio.id)
    if (remitente !== desafio.phone) {
      // A live code sent from ANOTHER number: counted; too many and the code dies.
      await this.deps.telefonos.registrarIntentoFallido(desafio.id, MAX_INTENTOS_FALLIDOS, ahora)
      await this.auditar(AUTH_EVENT_KIND.PHONE_VERIFICATION_FAILED, cuenta, 'denied', { reason: 'sender_mismatch', purpose: desafio.purpose })
      return invalido(desafio.id)
    }
    if (desafio.purpose === 'recuperar_contrasena') {
      const consumido = await this.deps.telefonos.consumir(desafio.id, entrada.wamid, ahora)
      if (!consumido) return invalido(desafio.id)
      await this.auditar(AUTH_EVENT_KIND.PHONE_RECOVERY_VERIFIED, cuenta, 'success', { phone: enmascararTelefono(desafio.phone) })
      return { resultado: 'recuperacion', desafioId: desafio.id, respuesta: RESPUESTAS_VERIFICACION.recuperacion }
    }
    const anterior = (await this.deps.telefonos.estado(cuenta.id))?.phoneNumber ?? null
    let consumido = false
    let vinculo: ResultadoVinculoWhatsapp = 'no_disponible'
    try {
      // Single use, identity phone and WhatsApp link in ONE transaction: any failure (a number or a
      // wa_id that belongs to someone else, a lost race) rolls everything back, and the success
      // text is only chosen after the commit.
      consumido = await this.deps.telefonos.transaccion(async (almacen) => {
        if (!(await almacen.consumir(desafio.id, entrada.wamid, ahora))) return false
        if ((await almacen.fijarVerificado(cuenta.id, desafio.phone, ahora)) === 'conflicto') throw new ConflictoTelefono()
        vinculo = await almacen.vincularWhatsapp({ waId: entrada.waId, accountId: cuenta.id, tenantId: cuenta.tenantId, telefonoAnterior: anterior && anterior !== desafio.phone ? anterior : null, correlationId: randomUUID(), now: ahora })
        if (vinculo === 'conflicto') throw new ConflictoVinculo()
        return true
      })
    } catch (error) {
      if (error instanceof ConflictoVinculo) {
        await this.deps.telefonos.invalidar(desafio.id, 'conflicto', ahora)
        await this.auditar(AUTH_EVENT_KIND.PHONE_VERIFICATION_FAILED, cuenta, 'denied', { reason: 'whatsapp_linked_elsewhere', purpose: desafio.purpose })
        return { resultado: 'vinculo_ocupado', desafioId: desafio.id, respuesta: RESPUESTAS_VERIFICACION.vinculoOcupado }
      }
      if (!(error instanceof ConflictoTelefono)) throw error
      await this.deps.telefonos.invalidar(desafio.id, 'conflicto', ahora)
      await this.auditar(AUTH_EVENT_KIND.PHONE_VERIFICATION_FAILED, cuenta, 'denied', { reason: 'phone_in_use', purpose: desafio.purpose })
      return invalido(desafio.id)
    }
    if (!consumido) {
      const actual = await this.deps.telefonos.desafio(desafio.id)
      return actual?.verifiedWamid === entrada.wamid ? { resultado: 'repetido', desafioId: desafio.id, respuesta: null } : invalido(desafio.id)
    }
    await this.auditar(anterior && anterior !== desafio.phone ? AUTH_EVENT_KIND.PHONE_CHANGED : AUTH_EVENT_KIND.PHONE_VERIFIED, cuenta, 'success', {
      phone: enmascararTelefono(desafio.phone),
      ...(anterior && anterior !== desafio.phone ? { previous: enmascararTelefono(anterior) } : {}),
    })
    return vinculo === 'no_disponible'
      ? { resultado: 'verificado', desafioId: desafio.id, respuesta: RESPUESTAS_VERIFICACION.verificado }
      : { resultado: 'vinculado', desafioId: desafio.id, respuesta: RESPUESTAS_VERIFICACION.vinculado }
  }

  // Transport result of the WhatsApp confirmation. A failure is recorded (sanitized code) and
  // NEVER reverts the verification.
  async registrarConfirmacion(desafioId: string, resultado: { ok: true } | { ok: false; error: string }) {
    const ahora = this.deps.now()
    await this.deps.telefonos.registrarConfirmacion(desafioId, resultado.ok ? { sentAt: ahora, error: null } : { sentAt: null, error: resultado.error.slice(0, 80) })
    if (!resultado.ok) {
      const desafio = await this.deps.telefonos.desafio(desafioId)
      const cuenta = desafio ? await this.deps.cuentas.getAccount(desafio.accountId) : undefined
      await this.auditar(AUTH_EVENT_KIND.PHONE_CONFIRMATION_FAILED, cuenta ?? null, 'accepted', { error: resultado.error.slice(0, 80) })
    }
  }

  // ---- administration (never marks a phone as verified) -------------------------------------

  async fijarPendientePorAdmin(adminId: string, accountId: string, telefono: unknown): Promise<{ ok: true; phoneMasked: string } | ErrorTelefono> {
    const normalizado = normalizarTelefono(telefono)
    if (!normalizado.ok) return { ok: false, code: 'INVALID_PHONE', motivo: normalizado.motivo }
    const cuenta = await this.deps.cuentas.getAccount(accountId)
    if (!cuenta) return { ok: false, code: 'NOT_FOUND' }
    await this.deps.telefonos.fijarPendiente(accountId, normalizado.e164)
    await this.auditar(AUTH_EVENT_KIND.PHONE_ADMIN_PENDING_SET, cuenta, 'success', { phone: enmascararTelefono(normalizado.e164), target: cuenta.id }, adminId)
    return { ok: true, phoneMasked: enmascararTelefono(normalizado.e164) }
  }

  // Frees a verified identity phone (e.g. the number changed owner). Audited.
  async quitarVerificadoPorAdmin(adminId: string, accountId: string): Promise<{ ok: true } | ErrorTelefono> {
    const cuenta = await this.deps.cuentas.getAccount(accountId)
    if (!cuenta) return { ok: false, code: 'NOT_FOUND' }
    const anterior = (await this.deps.telefonos.estado(accountId))?.phoneNumber
    await this.deps.telefonos.quitarVerificado(accountId)
    await this.auditar(AUTH_EVENT_KIND.PHONE_ADMIN_CLEARED, cuenta, 'success', { target: cuenta.id, ...(anterior ? { previous: enmascararTelefono(anterior) } : {}) }, adminId)
    return { ok: true }
  }
}
