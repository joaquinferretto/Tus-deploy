import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ALLOWED_REPOSITORY_NAME,
  buildExplicitGitCommand,
  resolveRepositoryBoundary,
  validateGitAction,
} from '../../scripts/sdd/git-boundary.mjs'

const REPO_ROOT = 'C:\\Users\\mmmau\\tuscompras-b2b\\Goldenrepo-js-py'
const SIBLING_ROOT = 'C:\\Users\\mmmau\\tuscompras-b2b\\Goldenrepo-js_py'

test('repository selection accepts relative, absolute, and explicit git -C paths only for the hyphenated repo', () => {
  for (const selection of [
    { cwd: '.', gitRoot: REPO_ROOT, args: [] },
    { cwd: REPO_ROOT, gitRoot: REPO_ROOT, args: [] },
    { cwd: 'C:\\Users\\mmmau\\tuscompras-b2b', gitRoot: REPO_ROOT, args: ['-C', REPO_ROOT] },
  ]) {
    const result = resolveRepositoryBoundary(selection)
    assert.equal(result.status, 'ready')
    assert.equal(result.repositoryName, ALLOWED_REPOSITORY_NAME)
  }
})

test('repository selection rejects the underscore sibling and ambiguous git -C input', () => {
  assert.throws(() => resolveRepositoryBoundary({ cwd: SIBLING_ROOT, gitRoot: SIBLING_ROOT, args: [] }), /Goldenrepo-js_py/u)
  assert.throws(() => resolveRepositoryBoundary({ cwd: REPO_ROOT, gitRoot: REPO_ROOT, args: ['-C', SIBLING_ROOT] }), /Goldenrepo-js_py/u)
  assert.throws(() => resolveRepositoryBoundary({ cwd: REPO_ROOT, gitRoot: '', args: [] }), /repository boundary/u)
})

test('relative git -C paths resolve from cwd and matching explicit roots are not ambiguous', () => {
  for (const selection of [
    { cwd: 'C:\\Users\\mmmau\\tuscompras-b2b', gitRoot: REPO_ROOT, args: ['git', '-C', 'Goldenrepo-js-py'] },
    { cwd: REPO_ROOT, gitRoot: REPO_ROOT, args: ['-C', '.'] },
  ]) {
    assert.equal(resolveRepositoryBoundary(selection).root, REPO_ROOT)
  }
  assert.throws(
    () => resolveRepositoryBoundary({ cwd: 'C:\\Users\\mmmau\\tuscompras-b2b', args: ['-C', 'Goldenrepo-js_py'] }),
    /Goldenrepo-js_py/u,
  )
})

test('commit boundary requires an intended staged index and refuses commit-all or empty state', () => {
  assert.throws(() => validateGitAction({ action: 'commit', stagedFiles: [] }), /staged/u)
  assert.throws(() => validateGitAction({ action: 'commit', stagedFiles: ['safe.ts'], commitAll: true }), /commit -a/u)
  assert.throws(() => validateGitAction({ action: 'commit', stagedFiles: ['safe.ts'], indexState: 'foreign' }), /index/u)
  assert.deepEqual(validateGitAction({ action: 'commit', stagedFiles: ['safe.ts'] }), { status: 'ready', action: 'commit' })
  assert.deepEqual(
    buildExplicitGitCommand({
      action: 'commit',
      repositoryRoot: REPO_ROOT,
      stagedFiles: ['scripts/sdd/git-boundary.mjs'],
      indexState: 'intended',
    }),
    ['git', '-C', REPO_ROOT, 'commit', '--', 'scripts/sdd/git-boundary.mjs'],
  )
})

test('push boundary requires an explicit destination and refspec without inferred tracking', () => {
  assert.throws(() => validateGitAction({ action: 'push', remote: 'origin', branch: 'feature/db' }), /refspec/u)
  assert.throws(() => validateGitAction({ action: 'push', refspec: 'HEAD' }), /remote/u)
  assert.deepEqual(validateGitAction({ action: 'push', remote: 'origin', branch: 'feature/db', refspec: 'HEAD:refs/heads/feature/db', tracking: true }), { status: 'ready', action: 'push' })
  assert.deepEqual(buildExplicitGitCommand({ action: 'push', repositoryRoot: REPO_ROOT, remote: 'origin', branch: 'feature/db', refspec: 'HEAD:refs/heads/feature/db' }), ['git', '-C', REPO_ROOT, 'push', 'origin', 'HEAD:refs/heads/feature/db'])
})
