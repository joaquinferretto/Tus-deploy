# Configuration

Configuration loaders and utilities go here.

Example:
```typescript
import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  MONGODB_URL: z.string().url(),
  // The resolver accepts MONGODB_URI only as a compatibility alias when
  // MONGODB_URL is absent; manifests must declare MONGODB_URL.
  REDIS_URL: z.string().url(),
  API_PORT: z.coerce.number().default(3101),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGINS: z.string().transform((val) => val.split(',')),
})

export const config = envSchema.parse(process.env)
```
