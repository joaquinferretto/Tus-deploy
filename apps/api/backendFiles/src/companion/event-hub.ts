import type http from 'http'
import { WebSocketServer, type WebSocket } from 'ws'
import { companionScopeSchema, type CompanionRealtimeEvent, type CompanionScope } from '@repo/zod-schemas'

const clients = new Map<string, Set<WebSocket>>()

export function publishCompanionEvent(event: CompanionRealtimeEvent): void {
  companionScopeSchema.parse({ sessionId: event.sessionId, familyId: event.familyId, conversationId: event.conversationId, role: event.role })
  const payload = JSON.stringify(event)
  const scopedClients = clients.get(scopeKey(event)) ?? new Set<WebSocket>()
  scopedClients.forEach((client) => {
    if (client.readyState === client.OPEN) client.send(payload)
  })
}

export function attachCompanionEventHub(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '', 'http://localhost')
    if (url.pathname !== '/companion/events') return
    const parsedScope = companionScopeSchema.safeParse({ role: url.searchParams.get('role'), sessionId: url.searchParams.get('sessionId'), familyId: url.searchParams.get('familyId'), conversationId: url.searchParams.get('conversationId') })
    if (!parsedScope.success) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const key = scopeKey(parsedScope.data)
      const roleClients = clients.get(key) ?? new Set<WebSocket>()
      roleClients.add(ws)
      clients.set(key, roleClients)
      ws.on('close', () => roleClients.delete(ws))
      wss.emit('connection', ws, request)
    })
  })
  return wss
}

function scopeKey(scope: CompanionScope): string {
  return `${scope.sessionId}:${scope.familyId}:${scope.conversationId}:${scope.role}`
}
