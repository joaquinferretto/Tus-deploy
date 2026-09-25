import { alcanceDeCuenta } from '../../auth-security/application/auth-service.ts'
import {
  IndiceConocimientoPrisma,
  TransaccionAsistentePrisma,
  type ClientePrismaAsistente,
} from '../adapters/prisma-asistente.ts'
import type { TusApplicationService } from '../application/tus-application-service.ts'
import {
  ResolutorCuentaIdentidad,
  crearModuloWhatsapp,
  type ModuloWhatsapp,
} from './composicion.ts'

// Production composition (PostgreSQL). The access token and app secret stay in env memory only.
export function crearModuloWhatsappPrisma(
  prisma: unknown,
  application: TusApplicationService,
  identityStore: ConstructorParameters<typeof ResolutorCuentaIdentidad>[0],
  env: Record<string, string | undefined> = process.env
): ModuloWhatsapp {
  const client = prisma as ClientePrismaAsistente
  return crearModuloWhatsapp({
    env,
    transaction: new TransaccionAsistentePrisma(client),
    accounts: new ResolutorCuentaIdentidad(identityStore, alcanceDeCuenta),
    application,
    knowledgeIndex: new IndiceConocimientoPrisma(client),
  })
}
