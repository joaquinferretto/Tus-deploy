// SafeLogger emits structured runtime logs on stdout; scenario results share that stream.
export function parseScenarioOutput(output) {
  const records = output.trim().split(/\r?\n/u).map(line => JSON.parse(line))
    .filter(value => !(value.timestamp && ['info', 'warn', 'error'].includes(value.level)))
  if (records.length !== 1) throw new Error('Expected exactly one scenario result')
  return records[0]
}
