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

console.log('[hostinger] Asegurando devDependencies del workspace...')
run([
  'install',
  '--prod=false',
  '--frozen-lockfile',
  '--ignore-scripts',
])

console.log('[hostinger] Compilando dependencias y API...')
run([
  '--filter',
  '@factory/api...',
  'build',
])

console.log('[hostinger] API compilada correctamente')

// Migraciones: después de compilar y antes de que Hostinger arranque la API. Si fallan, la
// instalación termina con exit != 0 y el despliegue queda marcado como fallido. La API nunca
// migra al arrancar. Requiere DATABASE_URL y DIRECT_URL en las variables del panel de Hostinger.
console.log('[hostinger] Aplicando migraciones de base de datos...')
const migrate = spawnSync(process.execPath, ['scripts/db/migrate-deploy.mjs'], {
  stdio: 'inherit',
  env: process.env,
  shell: false,
})

if (migrate.error || migrate.status !== 0) {
  console.error('[hostinger] Las migraciones fallaron: el despliegue se detiene sin arrancar la API nueva')
  process.exit(migrate.status || 1)
}

console.log('[hostinger] Migraciones aplicadas; base al día')