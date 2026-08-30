import type { Metadata, Viewport } from 'next'
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

export default function RootLayout({ children }: RootLayoutProps): React.ReactNode {
  return (
    <html lang={TUS_LOCALE}>
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
