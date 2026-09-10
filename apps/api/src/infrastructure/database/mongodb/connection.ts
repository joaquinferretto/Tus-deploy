import mongoose from 'mongoose'

let isConnected = false

const DEFAULT_MONGODB_URL = 'mongodb://localhost:27017/appdb'

export function resolveMongoUrl(environment: NodeJS.ProcessEnv): string {
  const canonicalUrl = environment['MONGODB_URL']?.trim()
  if (canonicalUrl) {
    return canonicalUrl
  }

  const compatibilityUrl = environment['MONGODB_URI']?.trim()
  if (compatibilityUrl) {
    return compatibilityUrl
  }

  if (environment['NODE_ENV'] === 'production' || environment['RENDER'] === 'true') {
    throw new Error('MONGODB_URL is required in production')
  }

  return DEFAULT_MONGODB_URL
}

export async function connectMongoDB(): Promise<void> {
  if (isConnected) {
    return
  }

  try {
    const mongoUrl = resolveMongoUrl(process.env)
    await mongoose.connect(mongoUrl, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    })

    isConnected = true
    console.log('MongoDB connected successfully')

    mongoose.connection.on('error', () => {
      console.error('MongoDB connection error')
      isConnected = false
    })

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected')
      isConnected = false
    })
  } catch (error) {
    console.error('Failed to connect to MongoDB')
    throw error
  }
}

export async function checkMongoDB(): Promise<boolean> {
  try {
    if (!isConnected) {
      await connectMongoDB()
    }
    return mongoose.connection.readyState === 1
  } catch (error) {
    console.error('MongoDB health check failed')
    return false
  }
}

export async function disconnectMongoDB(): Promise<void> {
  if (isConnected) {
    await mongoose.disconnect()
    isConnected = false
  }
}
