// Storage of the phone identity (on the person, "User") and of the single-use challenges
// (desafios_telefono). The identity phone is only written once VERIFIED; a number waiting for
// verification is the "pending" one and the challenge's expected phone.

export type PropositoDesafio = 'verificar_telefono' | 'cambiar_telefono' | 'recuperar_contrasena'
export type MotivoInvalidacion = 'reemplazado' | 'intentos' | 'conflicto'

export interface DesafioTelefono {
  id: string
  accountId: string
  phone: string
  purpose: PropositoDesafio
  codeHash: string
  pollSecretHash: string | null
  expiresAt: number
  usedAt: number | null
  invalidatedAt: number | null
  invalidationReason: MotivoInvalidacion | null
  failedAttempts: number
  verifiedWamid: string | null
  deliveredAt: number | null
  confirmationSentAt: number | null
  confirmationError: string | null
  createdAt: number
}

export interface EstadoTelefonoCuenta {
  phoneNumber: string | null
  phoneVerifiedAt: number | null
  phonePending: string | null
}

// Links the WhatsApp contact (wa_id from Meta) to the TUS account. It lives behind the same store as
// the challenge so it runs in the SAME transaction; 'no_disponible' only when no linker was wired.
export interface EntradaVinculoWhatsapp {
  waId: string
  accountId: string
  tenantId: string
  telefonoAnterior: string | null
  correlationId: string
  now: number
}
export type ResultadoVinculoWhatsapp = 'vinculado' | 'ya_vinculado' | 'conflicto' | 'no_disponible'
export type VinculadorWhatsapp = (entrada: EntradaVinculoWhatsapp) => Promise<Exclude<ResultadoVinculoWhatsapp, 'no_disponible'>>
// What the identity module needs from the assistant's contacts (the source of truth of the link).
export interface PuenteAsistente {
  vincular: VinculadorWhatsapp
  // The WhatsApp (wa_id) linked to the account, or null.
  waIdVinculado(accountId: string): Promise<string | null>
}

export interface AlmacenTelefonos {
  vincularWhatsapp(entrada: EntradaVinculoWhatsapp): Promise<ResultadoVinculoWhatsapp>
  waIdVinculado(accountId: string): Promise<string | null>
  estado(accountId: string): Promise<EstadoTelefonoCuenta | null>
  // Many accounts at once (admin lists): one read.
  estados(accountIds: readonly string[]): Promise<Map<string, EstadoTelefonoCuenta>>
  // Account whose VERIFIED identity phone is `phone`.
  cuentaPorTelefono(phone: string): Promise<string | null>
  // Whether a verification or link challenge for `phone` is still waiting to be sent from WhatsApp
  // (unused, not invalidated, not expired). A password recovery is not one.
  desafioVivoPara(phone: string, at: number): Promise<boolean>
  fijarPendiente(accountId: string, phone: string | null): Promise<void>
  // Replaces the identity phone. 'conflicto' when another person already has it (UNIQUE).
  fijarVerificado(accountId: string, phone: string, at: number): Promise<'ok' | 'conflicto'>
  quitarVerificado(accountId: string): Promise<void>
  // Invalidates the live challenge of the same account and purpose ('reemplazado') and creates it.
  crearDesafio(desafio: DesafioTelefono): Promise<void>
  desafio(id: string): Promise<DesafioTelefono | null>
  desafioPorHash(codeHash: string): Promise<DesafioTelefono | null>
  // Atomic single use: true only for the one caller that consumed an unused, live challenge.
  consumir(id: string, wamid: string, at: number): Promise<boolean>
  registrarIntentoFallido(id: string, maximo: number, at: number): Promise<void>
  invalidar(id: string, motivo: MotivoInvalidacion, at: number): Promise<void>
  // Atomic: true once (the password-reset authorization is handed over a single time).
  marcarEntregado(id: string, at: number): Promise<boolean>
  registrarConfirmacion(id: string, resultado: { sentAt: number | null; error: string | null }): Promise<void>
  transaccion<T>(operacion: (almacen: AlmacenTelefonos) => Promise<T>): Promise<T>
}
