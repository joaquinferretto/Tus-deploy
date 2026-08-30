import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { validatePlanFixture } from './contracts.mjs'

const root = join(import.meta.dirname, 'fixtures')
const profiles = ['render-native', 'aws-terraform']
const results = profiles.map((profile) => {
  const fixture = JSON.parse(readFileSync(join(root, `${profile}.json`), 'utf8'))
  return validatePlanFixture(fixture)
})

process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`)
if (results.some((result) => !result.valid)) process.exitCode = 1
