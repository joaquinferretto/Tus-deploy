import { alcanceDeCuenta } from '../../auth-security/application/auth-service.ts'
import {
  CuentasPorDocumentoPrisma,
  IndiceConocimientoPrisma,
  IndiceMemoriaPrisma,
  HechosPrisma,
  TransaccionAsistentePrisma,
  type ClientePrismaAsistente,
} from '../adapters/prisma-asistente.ts'
import type { TusApplicationService } from '../application/tus-application-service.ts'
import {
  ResolutorCuentaIdentidad,
  crearModuloWhatsapp,
  type ModuloWhatsapp,
} from './composicion.ts'
import type { ServiciosCompartidosAsistente } from './dominio.ts'
import type { VerificadorTelefonoWhatsapp } from './puertos.ts'

// Production composition (PostgreSQL). The access token and app secret stay in env memory only.
export function crearModuloWhatsappPrisma(
  prisma: unknown,
  application: TusApplicationService,
  identityStore: ConstructorParameters<typeof ResolutorCuentaIdentidad>[0],
  env: Record<string, string | undefined> = process.env,
  servicios?: ServiciosCompartidosAsistente,
  verificadorTelefono?: VerificadorTelefonoWhatsapp | null
): ModuloWhatsapp {
  const client = prisma as ClientePrismaAsistente
  return crearModuloWhatsapp({
    env,
    transaction: new TransaccionAsistentePrisma(client),
    accounts: new ResolutorCuentaIdentidad(identityStore, alcanceDeCuenta),
    application,
    ...(servicios ? { servicios } : {}),
    knowledgeIndex: new IndiceConocimientoPrisma(client),
    memoryIndex: new IndiceMemoriaPrisma(client),
    factStore: new HechosPrisma(client),
    verificadorTelefono: verificadorTelefono ?? null,
    nombreOperador: async (accountId) => (await (identityStore as unknown as { getAccount?: (id: string) => Promise<{ displayName?: string } | undefined> }).getAccount?.(accountId))?.displayName ?? null,
    identidades: new CuentasPorDocumentoPrisma(prisma as ConstructorParameters<typeof CuentasPorDocumentoPrisma>[0]),
  })
}
