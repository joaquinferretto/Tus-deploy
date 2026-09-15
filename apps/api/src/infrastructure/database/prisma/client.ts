import { PrismaClient } from '@prisma/client'
import { readRootDatabaseUrl } from '../../../platform/configuration/domain.ts'

let prisma: PrismaClient | undefined
let configuredDatabaseUrl: string | undefined

export function getPrismaClient(databaseUrl?: string): PrismaClient {
  if (prisma) {
    if (databaseUrl && configuredDatabaseUrl !== databaseUrl) {
      throw new Error('Prisma database configuration cannot change during process lifetime')
    }
    return prisma
  }

  // Bounded child runtimes may provide an explicit database URL; root .env is the fallback.
  const canonicalDatabaseUrl = databaseUrl ?? process.env['DATABASE_URL']?.trim() ?? readRootDatabaseUrl()
  if (!canonicalDatabaseUrl) throw new Error('Missing canonical PostgreSQL configuration')

  configuredDatabaseUrl = canonicalDatabaseUrl
  prisma = new PrismaClient({
    datasourceUrl: canonicalDatabaseUrl,
    log: ['error'],
  })
  return prisma
}

export async function connectPrisma(databaseUrl?: string, client = getPrismaClient(databaseUrl)): Promise<void> {
  await client.$connect()
}

export async function disconnectPrisma(client: PrismaClient | undefined = prisma): Promise<void> {
  if (prisma) {
    try {
      await client?.$disconnect()
    } finally {
      if (client === prisma) {
        prisma = undefined
        configuredDatabaseUrl = undefined
      }
    }
  }
}
