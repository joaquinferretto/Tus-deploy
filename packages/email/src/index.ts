export * from './domain.js'
export * from './ports.js'
export * from './templates.js'
export * from './fakes.js'
export * from './ses.js'

import { DeterministicEmailProvider } from './fakes.js'
import { SesEmailProvider } from './ses.js'
import { renderEmailTemplate } from './templates.js'

export default { DeterministicEmailProvider, SesEmailProvider, renderEmailTemplate }
