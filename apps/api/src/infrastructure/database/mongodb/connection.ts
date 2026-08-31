import mongoose from 'mongoose'

let isConnected = false

export async function connectMongoDB(): Promise<void> {
  if (isConnected) {
    return
  }

  try {
    const mongoUrl = process.env['MONGODB_URL'] || process.env['MONGODB_URI'] || 'mongodb://localhost:27017/appdb'
    await mongoose.connect(mongoUrl, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    })

    isConnected = true
    console.log('MongoDB connected successfully')

    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err)
      isConnected = false
    })

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected')
      isConnected = false
    })
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error)
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
    console.error('MongoDB health check failed:', error)
    return false
  }
}

export async function disconnectMongoDB(): Promise<void> {
  if (isConnected) {
    await mongoose.disconnect()
    isConnected = false
  }
}
