/** @type {import('next').NextConfig} */
const path = require('node:path')
const isWindows = process.platform === 'win32'
// pnpm's Windows symlinks cannot be copied into Next's standalone tree without elevated link
// privileges, so Windows local builds skip it. NEXT_DISABLE_STANDALONE=true opts out explicitly
// on any OS; Linux/Render builds keep the standalone contract (`node .next/standalone/server.js`).
const standaloneOptOut = process.env.NEXT_DISABLE_STANDALONE === 'true'

const nextConfig = {
  reactStrictMode: true,
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
