import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const envPath = join(root, '.env')
const schemaPath = join(root, 'apps/api/prisma/schema.prisma')
const prismaCliPath = join(root, 'apps/api/node_modules/prisma/build/index.js')

if (!existsSync(envPath) || !existsSync(prismaCliPath)) {
  console.error('Prisma validation unavailable: canonical root environment or local Prisma CLI is missing')
  process.exit(1)
}

const databaseUrl = readRootDatabaseUrl(envPath)
if (!databaseUrl) {
  console.error('Prisma validation unavailable: canonical root DATABASE_URL is missing')
  process.exit(1)
}

const result = spawnSync(process.execPath, [prismaCliPath, 'validate', '--schema', schemaPath], {
  cwd: root,
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'inherit',
})

if (result.error) {
  console.error('Prisma validation unavailable: local Prisma CLI could not be started')
  process.exit(1)
}

process.exit(result.status ?? 1)

function readRootDatabaseUrl(path) {
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/u)
    if (!match) continue
    const value = (match[1] ?? '').replace(/^(['"])(.*)\1$/u, '$2').trim()
    return value || undefined
  }
  return undefined
}
