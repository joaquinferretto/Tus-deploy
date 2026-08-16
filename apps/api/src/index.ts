import cluster from 'cluster'
import os from 'os'
import { startServer } from './server'

const numCPUs = os.cpus().length
const WORKERS = process.env.NODE_ENV === 'production' ? numCPUs : 1

if (cluster.isPrimary) {
  console.log(`Master ${process.pid} is running`)
  console.log(`Spawning ${WORKERS} worker(s)...`)

  // Fork workers
  for (let i = 0; i < WORKERS; i++) {
    cluster.fork()
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`)
    cluster.fork()
  })
} else {
  // Workers can share TCP connection
  startServer()
  console.log(`Worker ${process.pid} started`)
}
