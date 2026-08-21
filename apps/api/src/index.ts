import cluster from 'cluster'
import os from 'os'
import { startServer } from './server'

const numCPUs = os.cpus().length
const WORKERS = process.env['NODE_ENV'] === 'production' ? numCPUs : 1

if (cluster.isPrimary) {
  for (let i = 0; i < WORKERS; i++) {
    cluster.fork()
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`)
    cluster.fork()
  })
} else {
  startServer()
}
