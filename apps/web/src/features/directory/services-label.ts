import type { PrestadorPublico } from '@factory/contracts'

// "Electricidad · Plomería · Pintura": every service of the provider (principal first). Plain text:
// React renders it escaped, never as HTML.
export function servicesLabel(worker: Pick<PrestadorPublico, 'profession' | 'professions'>): string {
  const labels = worker.professions?.length ? worker.professions.map((item) => item.label) : [worker.profession.label]
  return [...new Set(labels)].join(' · ')
}
