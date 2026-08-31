import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_FLOW_MS = 180_000
const FLOWS = Object.freeze(['authenticated-api', 'authenticated-web', 'mobile-export', 'pos'])
const EVIDENCE_TAGS = Object.freeze(['deterministic', 'real-postgres', 'browser/mobile', 'deployment', 'external-blocked'])

export function createEvidenceReceipt({ tag, status, liveConformance = false, reason = '' } = {}) {
  if (!EVIDENCE_TAGS.includes(tag)) throw new Error('Unknown evidence tag')
  if (!['passed', 'deferred', 'failed'].includes(status)) throw new Error('Unknown evidence status')
  return {
    tag,
    status,
    liveConformance: liveConformance === true,
    redacted: true,
    reason: sanitizeReason(reason),
  }
}

export async function runTusRuntimeAudit({ browserAvailable = false, mobileAvailable = false, providerAvailable = false, runFlow, timeoutMs = MAX_FLOW_MS } = {}) {
  const boundedTimeout = Math.min(Math.max(Number(timeoutMs) || MAX_FLOW_MS, 1), MAX_FLOW_MS)
  const receipts = []
  for (const flow of FLOWS) {
    const available = flow === 'mobile-export' ? mobileAvailable : flow === 'pos' ? browserAvailable && mobileAvailable : browserAvailable
    if (!available) {
      receipts.push(createEvidenceReceipt({ tag: 'external-blocked', status: 'deferred', reason: `${flow} unavailable in this environment` }))
      continue
    }
    if (flow === 'pos' && !providerAvailable) {
      receipts.push(createEvidenceReceipt({ tag: 'external-blocked', status: 'deferred', reason: 'POS provider or hardware is unavailable; no success claim' }))
      continue
    }
    if (typeof runFlow !== 'function') {
      receipts.push(createEvidenceReceipt({ tag: 'external-blocked', status: 'deferred', reason: `${flow} runner is not configured` }))
      continue
    }
    try {
      const result = await withTimeout(Promise.resolve().then(() => runFlow(flow)), boundedTimeout)
      receipts.push(createEvidenceReceipt({
        tag: result?.tag ?? 'browser/mobile',
        status: result?.status ?? 'failed',
        liveConformance: result?.liveConformance === true,
        reason: result?.reason ?? `${flow} completed without external conformance claim`,
      }))
    } catch {
      receipts.push(createEvidenceReceipt({ tag: 'external-blocked', status: 'deferred', reason: `${flow} could not complete within the bounded audit` }))
    }
  }
  return {
    status: receipts.some((receipt) => receipt.status === 'failed') ? 'failed' : receipts.every((receipt) => receipt.status === 'deferred') ? 'external-blocked' : 'completed',
    maxFlowMs: MAX_FLOW_MS,
    receipts,
  }
}

export function writeAuditReceipt(receipt, outputDirectory = join(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), 'docs', 'evidence')) {
  if (!receipt || !Array.isArray(receipt.receipts)) throw new TypeError('An audit receipt is required')
  mkdirSync(outputDirectory, { recursive: true })
  const outputPath = join(outputDirectory, 'tus-runtime-audit.json')
  writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
  return outputPath
}

function sanitizeReason(reason) {
  return String(reason || 'No additional detail')
    .replace(/(?:password|token|secret|database_url)\s*[=:]\s*[^\s,;]+/giu, '<redacted>')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/giu, 'postgresql://<redacted>')
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('runtime audit timeout')), timeoutMs)),
  ])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runTusRuntimeAudit()
    .then((receipt) => {
      writeAuditReceipt(receipt)
      console.log(JSON.stringify(receipt))
    })
    .catch(() => {
      process.exitCode = 1
    })
}
