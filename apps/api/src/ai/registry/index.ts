export * from './domain.js'
export * from './adapters/in-memory.js'

import domain from './domain.js'
import memory from './adapters/in-memory.js'

export default { ...domain, ...memory }
