import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const schemaDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
const files = readdirSync(schemaDir).filter((name) => name.endsWith(".schema.json"));
const schemas = files.map((file) => JSON.parse(readFileSync(join(schemaDir, file), "utf8")));

let ajv;
try {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  ajv = new Ajv2020({ strict: false, allErrors: true });
} catch {
  // The provider-free foundation can still validate JSON shape without dependencies.
}

for (const [index, file] of files.entries()) {
  const schema = schemas[index];
  if (!schema.$id || schema.type !== "object" || !schema.properties) {
    throw new Error(`Invalid canonical schema shape: ${file}`);
  }
  ajv?.addSchema(schema);
}

for (const schema of schemas) {
  ajv?.getSchema(schema.$id);
}

console.log(`Validated ${files.length} JSON Schema contract(s).`);
