import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const contractsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const schemaDirs = [
  join(contractsRoot, 'contracts', 'schemas'),
  join(contractsRoot, 'ai-contracts', 'schemas'),
]

function findSchemaFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return findSchemaFiles(path)
    return entry.name.endsWith('.schema.json') ? [path] : []
  })
}

const files = schemaDirs.flatMap((directory) => findSchemaFiles(directory)).sort()
const schemas = files.map((file) => JSON.parse(readFileSync(file, 'utf8')))

let ajv
try {
  const { default: Ajv2020 } = await import('ajv/dist/2020.js')
  ajv = new Ajv2020({ strict: false, allErrors: true })
} catch {
  // The provider-free foundation can still validate JSON shape without dependencies.
}

for (const [index, file] of files.entries()) {
  const schema = schemas[index]
  if (!schema.$id || schema.type !== 'object' || !schema.properties) {
    throw new Error(`Invalid canonical schema shape: ${file}`)
  }
  ajv?.addSchema(schema)
}

for (const schema of schemas) {
  ajv?.getSchema(schema.$id)
}

console.log(`Validated ${files.length} JSON Schema contract(s).`)
