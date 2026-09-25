import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const apiRoot = join(repositoryRoot, 'apps', 'api')

// Resolve dependencies using Node's module resolution instead of assuming
// a physical node_modules layout. This works with pnpm workspaces,
// npm, local development, CI and Hostinger.
const requireFromApi = createRequire(join(apiRoot, 'package.json'))

const prismaPackageJson = requireFromApi.resolve('prisma/package.json')
const typescriptPackageJson = requireFromApi.resolve('typescript/package.json')

const prismaCli = join(dirname(prismaPackageJson), 'build', 'index.js')
const typescriptCli = join(dirname(typescriptPackageJson), 'bin', 'tsc')

function redact(output) {
  return output.replace(
    /(?:postgres(?:ql)?):\/\/[^\s'"`]+/giu,
    'postgresql://<redacted>'
  )
}

function run(label, script, args) {
  return new Promise((resolveRun, rejectRun) => {
    console.log(`[api build] ${label}`)

    const child = spawn(process.execPath, [script, ...args], {
      cwd: apiRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let output = ''

    child.stdout.on('data', (chunk) => {
      output += String(chunk)
    })

    child.stderr.on('data', (chunk) => {
      output += String(chunk)
    })

    child.once('error', rejectRun)

    child.once('close', (code) => {
      const safeOutput = redact(output)

      if (safeOutput) {
        process.stderr.write(safeOutput)
      }

      resolveRun({
        code: code ?? 1,
        output,
      })
    })
  })
}

async function build() {
  const generated = await run(
    'Prisma client generation',
    prismaCli,
    ['generate']
  )

  if (generated.code !== 0) {
    if (
      /EPERM[\s\S]*rename[\s\S]*query_engine-windows/iu.test(
        generated.output
      )
    ) {
      throw new Error(
        '[api build] Windows Prisma query engine is locked; stop the owned API process and retry. Generated artifacts were not deleted.'
      )
    }

    throw new Error(
      `[api build] Prisma client generation failed with exit code ${generated.code}`
    )
  }

  const compiled = await run(
    'TypeScript compilation',
    typescriptCli,
    []
  )

  if (compiled.code !== 0) {
    throw new Error(
      `[api build] TypeScript compilation failed with exit code ${compiled.code}`
    )
  }

  console.log('[api build] Build completed successfully')
}

build().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : '[api build] failed'
  )

  process.exitCode = 1
})