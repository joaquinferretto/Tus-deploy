import { basename, isAbsolute, resolve } from 'node:path'

export const ALLOWED_REPOSITORY_NAME = 'Goldenrepo-js-py'
export const FORBIDDEN_REPOSITORY_NAME = 'Goldenrepo-js_py'

export function resolveRepositoryBoundary({ cwd, gitRoot, args = [] } = {}) {
  if (cwd) rejectForbiddenPath(resolve(cwd))
  const explicitRoot = gitRoot ? resolve(gitRoot) : null
  const gitC = parseGitC(args)
  const selectedRoot = gitC ? resolve(cwd ?? process.cwd(), gitC) : explicitRoot
  if (!selectedRoot) throw new Error('repository boundary must be explicit')
  if (gitC && explicitRoot && selectedRoot !== explicitRoot) throw new Error('repository boundary selection is ambiguous')
  assertAllowedRepositoryPath(selectedRoot)
  return { status: 'ready', repositoryName: ALLOWED_REPOSITORY_NAME, root: selectedRoot }
}

export function assertAllowedRepositoryPath(repositoryPath) {
  const normalized = resolve(repositoryPath)
  const name = basename(normalized)
  rejectForbiddenPath(normalized)
  if (name !== ALLOWED_REPOSITORY_NAME) throw new Error(`repository boundary requires ${ALLOWED_REPOSITORY_NAME}`)
  return normalized
}

function rejectForbiddenPath(repositoryPath) {
  if (basename(repositoryPath) === FORBIDDEN_REPOSITORY_NAME || repositoryPath.includes(`\\${FORBIDDEN_REPOSITORY_NAME}\\`) || repositoryPath.includes(`/${FORBIDDEN_REPOSITORY_NAME}/`)) {
    throw new Error(`repository boundary rejects ${FORBIDDEN_REPOSITORY_NAME}`)
  }
}

export function validateGitAction({ action, stagedFiles = [], commitAll = false, remote, branch, refspec } = {}) {
  if (action === 'commit') {
    if (commitAll) throw new Error('repository boundary refuses commit -a')
    if (!Array.isArray(stagedFiles) || stagedFiles.length === 0) throw new Error('repository boundary requires intended staged files')
    return { status: 'ready', action }
  }
  if (action === 'push') {
    if (!nonBlank(remote)) throw new Error('push destination remote is required')
    if (!nonBlank(branch)) throw new Error('push destination branch is required')
    if (!nonBlank(refspec)) throw new Error('push destination refspec must be explicit')
    return { status: 'ready', action }
  }
  throw new Error(`unsupported git action: ${String(action ?? '')}`)
}

export function buildExplicitGitCommand({ action, repositoryRoot, remote, refspec, ...state } = {}) {
  const root = assertAllowedRepositoryPath(repositoryRoot)
  validateGitAction({ action, remote, refspec, ...state })
  if (action === 'push') return ['git', '-C', root, 'push', remote, refspec]
  return ['git', '-C', root, 'commit']
}

function parseGitC(args) {
  if (!Array.isArray(args)) throw new TypeError('git arguments must be an array')
  const values = args.filter((argument) => argument !== 'git')
  const index = values.indexOf('-C')
  if (index === -1) return null
  const value = values[index + 1]
  if (!nonBlank(value) || values.indexOf('-C', index + 1) !== -1) throw new Error('git -C repository selection is ambiguous')
  return isAbsolute(value) ? value : value
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export default {
  ALLOWED_REPOSITORY_NAME,
  FORBIDDEN_REPOSITORY_NAME,
  resolveRepositoryBoundary,
  assertAllowedRepositoryPath,
  validateGitAction,
  buildExplicitGitCommand,
}
