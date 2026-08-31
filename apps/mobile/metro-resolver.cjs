/* eslint-env node */

const path = require('node:path')

const WEB_ZUSTAND_MIDDLEWARE = path.join(__dirname, 'src', 'store', 'web-zustand-middleware.js')

function resolveMobileModule(context, moduleName, platform) {
  if (platform === 'web' && moduleName === 'zustand/middleware') {
    return { type: 'sourceFile', filePath: WEB_ZUSTAND_MIDDLEWARE }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = { resolveMobileModule, WEB_ZUSTAND_MIDDLEWARE }
