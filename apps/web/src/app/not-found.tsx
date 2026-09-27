import { redirect } from 'next/navigation'

// Unknown Web routes have one safe destination. API 404 responses are handled separately by Express.
export default function NotFound(): never {
  redirect('/')
}
