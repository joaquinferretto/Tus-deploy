import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";

const ajv = new Ajv({ strict: true, allErrors: true });
const schemaDir = join(process.cwd(), "schemas");
const files = readdirSync(schemaDir).filter((name) => name.endsWith(".schema.json"));

for (const file of files) {
  const raw = readFileSync(join(schemaDir, file), "utf8");
  const schema = JSON.parse(raw);
  ajv.compile(schema);
}

console.log(`Validated ${files.length} JSON Schema contract(s).`);
