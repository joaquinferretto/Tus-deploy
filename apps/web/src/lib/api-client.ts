import { z } from 'zod'

const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface FetchOptions extends RequestInit {
  timeout?: number
}

async function fetchWithTimeout(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeout = 10000, ...fetchOptions } = options

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

export async function apiClient<T>(
  endpoint: string,
  options: FetchOptions = {},
  schema?: z.ZodSchema<T>
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`

  try {
    const response = await fetchWithTimeout(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new ApiError(response.status, errorData.message || `HTTP ${response.status}`, errorData)
    }

    const data = await response.json()

    if (schema) {
      return schema.parse(data)
    }

    return data as T
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    throw new Error(
      `API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
