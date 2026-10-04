/** @type {import('next').NextConfig} */
const path = require('node:path')
const isWindows = process.platform === 'win32'
// pnpm's Windows symlinks cannot be copied into Next's standalone tree without elevated link
// privileges, so Windows local builds skip it. NEXT_DISABLE_STANDALONE=true opts out explicitly
// on any OS; Linux/Render builds keep the standalone contract (`node .next/standalone/server.js`).
const standaloneOptOut = process.env.NEXT_DISABLE_STANDALONE === 'true'

// Static security headers for every response (documents, chunks, images). The Content Security
// Policy needs a per-request nonce, so it is set by src/middleware.ts instead.
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()',
  },
]

const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  reactStrictMode: true,
  // AYUDA-01: the documents of docs/conocimiento are bundled as TEXT (never as code) so the Help
  // Center renders the same files the assistant's knowledge index reads. No MDX, no evaluation.
  webpack(config) {
    config.module.rules.push({ test: /\.md$/, type: 'asset/source' })
    return config
  },
  typedRoutes: true,
  output: isWindows ? undefined : 'standalone',
  ...(standaloneOptOut ? { output: undefined } : {}),
  outputFileTracingRoot: path.join(__dirname, '../..'),
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
}

module.exports = nextConfig
