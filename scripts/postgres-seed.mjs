import { parsePostgresSeedArguments, runTusPostgresSeed } from './test-runner-lib.mjs'

const invocation = parsePostgresSeedArguments(process.argv.slice(2))
const evidence = await runTusPostgresSeed({
  intent: invocation.intent,
  confirmed: invocation.confirmed && invocation.invalidArguments.length === 0,
})
console.log(JSON.stringify(evidence))
process.exitCode = evidence.status === 'passed' ? 0 : 2
