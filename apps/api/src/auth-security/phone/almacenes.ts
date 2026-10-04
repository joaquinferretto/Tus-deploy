import type { Account } from '../domain/models.js'
import type { AlmacenTelefonos, DesafioTelefono, EntradaVinculoWhatsapp, EstadoTelefonoCuenta, MotivoInvalidacion, PuenteAsistente, ResultadoVinculoWhatsapp } from './puertos.ts'

const vivo = (desafio: DesafioTelefono) => desafio.usedAt === null && desafio.invalidatedAt === null

// ---- in memory (tests / local composition) ---------------------------------------------------
// Works on the accounts of the in-memory identity store, so a phone written here is what
// sign-in and the rest of the identity code read.
export class AlmacenTelefonosEnMemoria implements AlmacenTelefonos {
  readonly desafios = new Map<string, DesafioTelefono>()
  private cola: Promise<unknown> = Promise.resolve()

  // `asistente.puente` runs against the assistant's in-memory contacts and `instantanea()` returns
  // the function that restores them when the transaction fails, like PostgreSQL would.
  constructor(
    private readonly identidad: { accounts?: Map<string, Account> },
    private readonly asistente: { puente: PuenteAsistente; instantanea(): () => void } | null = null
  ) {}

  async vincularWhatsapp(entrada: EntradaVinculoWhatsapp): Promise<ResultadoVinculoWhatsapp> {
    return this.asistente ? this.asistente.puente.vincular(entrada) : 'no_disponible'
  }

  async waIdVinculado(accountId: string) {
    return this.asistente ? this.asistente.puente.waIdVinculado(accountId) : null
  }

  private cuentas(): Map<string, Account> {
    return this.identidad.accounts ?? new Map()
  }

  async estado(accountId: string): Promise<EstadoTelefonoCuenta | null> {
    const cuenta = this.cuentas().get(accountId)
    return cuenta ? { phoneNumber: cuenta.phoneNumber ?? null, phoneVerifiedAt: cuenta.phoneVerifiedAt ?? null, phonePending: cuenta.phonePending ?? null } : null
  }

  async estados(accountIds: readonly string[]) {
    const resultado = new Map<string, EstadoTelefonoCuenta>()
    for (const id of accountIds) {
      const estado = await this.estado(id)
      if (estado) resultado.set(id, estado)
    }
    return resultado
  }

  async cuentaPorTelefono(phone: string) {
    return [...this.cuentas().values()].find((cuenta) => cuenta.phoneNumber === phone)?.id ?? null
  }

  async fijarPendiente(accountId: string, phone: string | null) {
    const cuenta = this.cuentas().get(accountId)
    if (cuenta) cuenta.phonePending = phone
  }

  async fijarVerificado(accountId: string, phone: string, at: number): Promise<'ok' | 'conflicto'> {
    const cuenta = this.cuentas().get(accountId)
    if (!cuenta) return 'conflicto'
    if ([...this.cuentas().values()].some((otra) => otra.id !== accountId && otra.phoneNumber === phone)) return 'conflicto'
    cuenta.phoneNumber = phone
    cuenta.phoneVerifiedAt = at
    if (cuenta.phonePending === phone) cuenta.phonePending = null
    return 'ok'
  }

  async quitarVerificado(accountId: string) {
    const cuenta = this.cuentas().get(accountId)
    if (cuenta) {
      cuenta.phoneNumber = null
      cuenta.phoneVerifiedAt = null
    }
  }

  async crearDesafio(desafio: DesafioTelefono) {
    for (const otro of this.desafios.values())
      if (otro.accountId === desafio.accountId && otro.purpose === desafio.purpose && vivo(otro)) {
        otro.invalidatedAt = desafio.createdAt
        otro.invalidationReason = 'reemplazado'
      }
    this.desafios.set(desafio.id, { ...desafio })
  }

  async desafio(id: string) {
    const desafio = this.desafios.get(id)
    return desafio ? { ...desafio } : null
  }

  async desafioPorHash(codeHash: string) {
    const desafio = [...this.desafios.values()].find((item) => item.codeHash === codeHash)
    return desafio ? { ...desafio } : null
  }

  async consumir(id: string, wamid: string, at: number) {
    const desafio = this.desafios.get(id)
    if (!desafio || !vivo(desafio) || desafio.expiresAt <= at) return false
    desafio.usedAt = at
    desafio.verifiedWamid = wamid
    return true
  }

  async registrarIntentoFallido(id: string, maximo: number, at: number) {
    const desafio = this.desafios.get(id)
    if (!desafio || !vivo(desafio)) return
    desafio.failedAttempts += 1
    if (desafio.failedAttempts >= maximo) {
      desafio.invalidatedAt = at
      desafio.invalidationReason = 'intentos'
    }
  }

  async invalidar(id: string, motivo: MotivoInvalidacion, at: number) {
    const desafio = this.desafios.get(id)
    if (!desafio || desafio.invalidatedAt !== null) return
    desafio.invalidatedAt = at
    desafio.invalidationReason = motivo
  }

  async marcarEntregado(id: string, at: number) {
    const desafio = this.desafios.get(id)
    if (!desafio || desafio.deliveredAt !== null) return false
    desafio.deliveredAt = at
    return true
  }

  async registrarConfirmacion(id: string, resultado: { sentAt: number | null; error: string | null }) {
    const desafio = this.desafios.get(id)
    if (!desafio) return
    desafio.confirmationSentAt = resultado.sentAt
    desafio.confirmationError = resultado.error
  }

  // Serialized (like the in-memory identity store): a whole operation runs before the next one.
  async transaccion<T>(operacion: (almacen: AlmacenTelefonos) => Promise<T>): Promise<T> {
    const resultado = this.cola.then(async () => {
      const desafios = structuredClone([...this.desafios])
      const cuentas = [...this.cuentas().values()].map((cuenta) => ({ cuenta, phoneNumber: cuenta.phoneNumber, phoneVerifiedAt: cuenta.phoneVerifiedAt, phonePending: cuenta.phonePending }))
      const restaurarAsistente = this.asistente?.instantanea()
      try {
        return await operacion(this)
      } catch (error) {
        this.desafios.clear()
        for (const [id, desafio] of desafios) this.desafios.set(id, desafio)
        for (const previa of cuentas) Object.assign(previa.cuenta, { phoneNumber: previa.phoneNumber, phoneVerifiedAt: previa.phoneVerifiedAt, phonePending: previa.phonePending })
        restaurarAsistente?.()
        throw error
      }
    })
    this.cola = resultado.catch(() => undefined)
    return resultado
  }
}

// ---- PostgreSQL (Prisma) ---------------------------------------------------------------------

type Fila = Record<string, unknown>

export interface ClientePrismaTelefonos {
  account: { findUnique(input: Fila): Promise<Fila | null>; findMany(input: Fila): Promise<Fila[]> }
  user: { findUnique(input: Fila): Promise<Fila | null>; update(input: Fila): Promise<Fila> }
  desafioTelefono: {
    create(input: Fila): Promise<Fila>
    findUnique(input: Fila): Promise<Fila | null>
    updateMany(input: Fila): Promise<{ count: number }>
  }
  $transaction<T>(operacion: (cliente: ClientePrismaTelefonos) => Promise<T>, options?: Fila): Promise<T>
}

const fecha = (valor: unknown) => (valor instanceof Date ? valor.getTime() : null)

function desdeFila(fila: Fila): DesafioTelefono {
  return {
    id: String(fila['id']),
    accountId: String(fila['cuentaId']),
    phone: String(fila['telefono']),
    purpose: String(fila['proposito']) as DesafioTelefono['purpose'],
    codeHash: String(fila['hashDesafio']),
    pollSecretHash: (fila['hashSecretoConsulta'] as string | null) ?? null,
    expiresAt: fecha(fila['expiraEn']) ?? 0,
    usedAt: fecha(fila['usadoEn']),
    invalidatedAt: fecha(fila['invalidadoEn']),
    invalidationReason: (fila['motivoInvalidacion'] as MotivoInvalidacion | null) ?? null,
    failedAttempts: Number(fila['intentosFallidos'] ?? 0),
    verifiedWamid: (fila['wamidVerificacion'] as string | null) ?? null,
    deliveredAt: fecha(fila['entregadoEn']),
    confirmationSentAt: fecha(fila['confirmacionEnviadaEn']),
    confirmationError: (fila['confirmacionError'] as string | null) ?? null,
    createdAt: fecha(fila['creadoEn']) ?? 0,
  }
}

const esConflictoUnico = (error: unknown) => (error as { code?: unknown })?.code === 'P2002'

export class AlmacenTelefonosPrisma implements AlmacenTelefonos {
  // `puente(client)` builds the bridge on the SAME client, so inside `transaccion` it joins the
  // transaction of the challenge.
  constructor(
    private readonly client: ClientePrismaTelefonos,
    private readonly puente: ((client: ClientePrismaTelefonos) => PuenteAsistente) | null = null
  ) {}

  async vincularWhatsapp(entrada: EntradaVinculoWhatsapp): Promise<ResultadoVinculoWhatsapp> {
    return this.puente ? this.puente(this.client).vincular(entrada) : 'no_disponible'
  }

  async waIdVinculado(accountId: string) {
    return this.puente ? this.puente(this.client).waIdVinculado(accountId) : null
  }

  private async userId(accountId: string): Promise<string | null> {
    const fila = await this.client.account.findUnique({ where: { id: accountId }, select: { userId: true } })
    return fila ? String(fila['userId']) : null
  }

  async estado(accountId: string): Promise<EstadoTelefonoCuenta | null> {
    const fila = await this.client.account.findUnique({ where: { id: accountId }, select: { user: { select: { phoneNumber: true, phoneVerifiedAt: true, phonePending: true } } } })
    const user = fila?.['user'] as Fila | undefined
    return user ? { phoneNumber: (user['phoneNumber'] as string | null) ?? null, phoneVerifiedAt: fecha(user['phoneVerifiedAt']), phonePending: (user['phonePending'] as string | null) ?? null } : null
  }

  async estados(accountIds: readonly string[]) {
    const resultado = new Map<string, EstadoTelefonoCuenta>()
    if (accountIds.length === 0) return resultado
    const filas = await this.client.account.findMany({ where: { id: { in: [...new Set(accountIds)] } }, select: { id: true, user: { select: { phoneNumber: true, phoneVerifiedAt: true, phonePending: true } } } })
    for (const fila of filas) {
      const user = fila['user'] as Fila
      resultado.set(String(fila['id']), { phoneNumber: (user['phoneNumber'] as string | null) ?? null, phoneVerifiedAt: fecha(user['phoneVerifiedAt']), phonePending: (user['phonePending'] as string | null) ?? null })
    }
    return resultado
  }

  async cuentaPorTelefono(phone: string) {
    const user = await this.client.user.findUnique({ where: { phoneNumber: phone }, select: { accounts: { select: { id: true }, orderBy: { createdAt: 'asc' }, take: 1 } } })
    const cuentas = (user?.['accounts'] as Fila[] | undefined) ?? []
    return cuentas[0] ? String(cuentas[0]['id']) : null
  }

  async fijarPendiente(accountId: string, phone: string | null) {
    const userId = await this.userId(accountId)
    if (userId) await this.client.user.update({ where: { id: userId }, data: { phonePending: phone } })
  }

  async fijarVerificado(accountId: string, phone: string, at: number): Promise<'ok' | 'conflicto'> {
    const fila = await this.client.account.findUnique({ where: { id: accountId }, select: { userId: true, user: { select: { phonePending: true } } } })
    if (!fila) return 'conflicto'
    const pendiente = (fila['user'] as Fila)['phonePending']
    try {
      await this.client.user.update({
        where: { id: String(fila['userId']) },
        data: { phoneNumber: phone, phoneVerifiedAt: new Date(at), ...(pendiente === phone ? { phonePending: null } : {}) },
      })
      return 'ok'
    } catch (error) {
      if (esConflictoUnico(error)) return 'conflicto'
      throw error
    }
  }

  async quitarVerificado(accountId: string) {
    const userId = await this.userId(accountId)
    if (userId) await this.client.user.update({ where: { id: userId }, data: { phoneNumber: null, phoneVerifiedAt: null } })
  }

  async crearDesafio(desafio: DesafioTelefono) {
    await this.client.desafioTelefono.updateMany({
      where: { cuentaId: desafio.accountId, proposito: desafio.purpose, usadoEn: null, invalidadoEn: null },
      data: { invalidadoEn: new Date(desafio.createdAt), motivoInvalidacion: 'reemplazado' },
    })
    await this.client.desafioTelefono.create({
      data: {
        id: desafio.id,
        cuentaId: desafio.accountId,
        telefono: desafio.phone,
        proposito: desafio.purpose,
        hashDesafio: desafio.codeHash,
        hashSecretoConsulta: desafio.pollSecretHash,
        expiraEn: new Date(desafio.expiresAt),
        intentosFallidos: 0,
        creadoEn: new Date(desafio.createdAt),
      },
    })
  }

  async desafio(id: string) {
    const fila = await this.client.desafioTelefono.findUnique({ where: { id } })
    return fila ? desdeFila(fila) : null
  }

  async desafioPorHash(codeHash: string) {
    const fila = await this.client.desafioTelefono.findUnique({ where: { hashDesafio: codeHash } })
    return fila ? desdeFila(fila) : null
  }

  // One conditional UPDATE: two concurrent deliveries of the same code cannot both succeed.
  async consumir(id: string, wamid: string, at: number) {
    const resultado = await this.client.desafioTelefono.updateMany({
      where: { id, usadoEn: null, invalidadoEn: null, expiraEn: { gt: new Date(at) } },
      data: { usadoEn: new Date(at), wamidVerificacion: wamid },
    })
    return resultado.count === 1
  }

  async registrarIntentoFallido(id: string, maximo: number, at: number) {
    await this.client.desafioTelefono.updateMany({ where: { id, usadoEn: null, invalidadoEn: null }, data: { intentosFallidos: { increment: 1 } } })
    await this.client.desafioTelefono.updateMany({
      where: { id, usadoEn: null, invalidadoEn: null, intentosFallidos: { gte: maximo } },
      data: { invalidadoEn: new Date(at), motivoInvalidacion: 'intentos' },
    })
  }

  async invalidar(id: string, motivo: MotivoInvalidacion, at: number) {
    await this.client.desafioTelefono.updateMany({ where: { id, invalidadoEn: null }, data: { invalidadoEn: new Date(at), motivoInvalidacion: motivo } })
  }

  async marcarEntregado(id: string, at: number) {
    const resultado = await this.client.desafioTelefono.updateMany({ where: { id, entregadoEn: null }, data: { entregadoEn: new Date(at) } })
    return resultado.count === 1
  }

  async registrarConfirmacion(id: string, resultado: { sentAt: number | null; error: string | null }) {
    await this.client.desafioTelefono.updateMany({
      where: { id },
      data: { confirmacionEnviadaEn: resultado.sentAt === null ? null : new Date(resultado.sentAt), confirmacionError: resultado.error },
    })
  }

  async transaccion<T>(operacion: (almacen: AlmacenTelefonos) => Promise<T>): Promise<T> {
    return this.client.$transaction((cliente) => operacion(new AlmacenTelefonosPrisma(cliente, this.puente)))
  }
}
