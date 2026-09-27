import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { test } from 'node:test'

const root = join(process.cwd(), 'apps', 'web')
const appRoot = join(root, 'src', 'app')
const sourceRoot = join(root, 'src')

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

function routeFromPage(path) {
  const relativePath = relative(appRoot, path).split(sep).join('/')
  if (!/^page\.(?:ts|tsx)$/u.test(relativePath.split('/').at(-1) ?? '')) return null
  const segments = relativePath.split('/')
  segments.pop()
  const route = segments
    .filter((segment) => !/^\([^/]+\)$/u.test(segment))
    .map((segment) => (segment.startsWith('[') ? `:${segment.slice(1, -1)}` : segment))
  return `/${route.join('/')}`.replace(/\/+/gu, '/') || '/'
}

function routeExists(candidate, routes) {
  const normalized = candidate.replace(/\/$/u, '') || '/'
  return routes.some((route) => {
    if (route === normalized) return true
    const routeSegments = route.split('/').filter(Boolean)
    const candidateSegments = normalized.split('/').filter(Boolean)
    if (candidateSegments.length > routeSegments.length) return false
    return candidateSegments.every((segment, index) => {
      const expected = routeSegments[index]
      return expected?.startsWith(':') || expected === segment
    })
  })
}

function webPathReferences() {
  const literal = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/gu
  const references = []
  for (const path of filesUnder(sourceRoot).filter((item) => /\.(?:ts|tsx)$/u.test(item))) {
    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(literal)) {
      const raw = match[2] ?? ''
      if (!raw.startsWith('/')) continue
      const candidate = raw.split('${')[0].split(/[?#]/u)[0].replace(/\\`/gu, '')
      if (!candidate || candidate === '/...' || candidate.startsWith('/tus/v1/') || candidate.startsWith('/auth/oauth/') || candidate.startsWith('/auth/session') || candidate.startsWith('/auth/sign-out') || candidate.startsWith('/auth/register') || candidate.startsWith('/auth/recovery/') || candidate.startsWith('/auth/mfa/') || candidate.startsWith('/auth/verify-email') || candidate.startsWith('/((') || candidate.startsWith('/tus/pos/manual-operations') || candidate.startsWith('/brand/') || /^\/(?:manifest\.webmanifest|icon-\d+\.svg)$/u.test(candidate)) continue
      references.push({ path: relative(process.cwd(), path), candidate })
    }
  }
  return references
}

test('WEB routes: every internal path literal resolves to a filesystem route', () => {
  const routes = filesUnder(appRoot).map(routeFromPage).filter((route) => route !== null)
  const broken = webPathReferences().filter(({ candidate }) => !routeExists(candidate, routes))
  assert.deepEqual(broken, [], `Unknown Web routes:\n${broken.map(({ path, candidate }) => `- ${path}: ${candidate}`).join('\n')}`)
})

test('WEB fallback: unknown root and TUS segment routes return to the home page', () => {
  const globalNotFound = readFileSync(join(appRoot, 'not-found.tsx'), 'utf8')
  const tusNotFound = readFileSync(join(appRoot, 'tus', 'not-found.tsx'), 'utf8')
  assert.match(globalNotFound, /redirect\('\/'\)/u)
  assert.match(tusNotFound, /redirect\('\/'\)/u)
})
