import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { ProfileGate } from '@/features/profile/profile-gate'
import { QueryProvider } from '@/lib/query-client'
import { resolveTusPublicOrigin, TUS_LOCALE } from '@/lib/tus-journeys'
import './globals.css'

interface RootLayoutProps {
  children: React.ReactNode
}

export const metadata: Metadata = {
  title: 'TUS platform',
  description: 'Argentina-first marketplace and merchant operations.',
  metadataBase: new URL(resolveTusPublicOrigin()),
  alternates: { canonical: '/' },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon-192.svg',
    apple: '/icon-192.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'TUS',
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f4f0e7',
  colorScheme: 'light',
}

// Reading the request headers renders every page per request: the CSP nonce set by the middleware
// is fresh on each response (a prerendered page would carry no nonce and its scripts would be blocked).
export default async function RootLayout({ children }: RootLayoutProps): Promise<React.ReactNode> {
  await headers()
  return (
    <html lang={TUS_LOCALE}>
      <body>
        <QueryProvider>
          <ProfileGate />
          {children}
        </QueryProvider>
      </body>
    </html>
  )
}
