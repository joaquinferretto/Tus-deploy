import type { Metadata } from 'next'
import { QueryProvider } from '@/lib/query-client'

export const metadata: Metadata = {
  title: 'Production Turborepo',
  description: 'Next.js 15 + React 19 + Zustand + React Query',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
