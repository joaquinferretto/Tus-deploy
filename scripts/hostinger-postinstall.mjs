import { spawnSync } from 'node:child_process'

if (process.env.HOSTINGER_API_BUILD !== '1') {
  console.log('[hostinger] HOSTINGER_API_BUILD != 1, se omite build de API')
  process.exit(0)
}

function run(args) {
  console.log(`[hostinger] corepack pnpm ${args.join(' ')}`)

  const result = spawnSync('corepack', ['pnpm', ...args], {
    stdio: 'inherit',
    env: process.env,
    shell: false,
  })

  if (result.error) {
    console.error(result.error)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('[hostinger] Generando Prisma Client...')
run(['--filter', '@factory/api', 'prisma:generate'])

console.log('[hostinger] Compilando dependencias y API...')
run(['--filter', '@factory/api...', 'build'])

console.log('[hostinger] API compilada correctamente')