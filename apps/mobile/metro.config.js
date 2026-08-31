const { getDefaultConfig } = require('expo/metro-config')
const { resolveMobileModule } = require('./metro-resolver.cjs')

const config = getDefaultConfig(__dirname)

config.resolver = {
  ...config.resolver,
  resolveRequest: resolveMobileModule,
}

module.exports = config
