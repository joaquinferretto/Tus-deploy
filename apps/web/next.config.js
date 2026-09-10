/** @type {import('next').NextConfig} */
const path = require('node:path')
const isWindows = process.platform === 'win32'

const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // pnpm's Windows symlinks cannot be copied into Next's standalone tree without
  // elevated link privileges; production Linux builds retain the standalone contract.
  output: isWindows ? undefined : 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
}

module.exports = nextConfig
