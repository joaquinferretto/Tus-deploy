import { AUDIO_SOURCE, VITAL_KIND, type CompanionAudioRef, type CompanionVital } from '@repo/zod-schemas'

export interface FamilyMessageInput { senderName: string; text: string; audio?: CompanionAudioRef }
export interface FamilyMessage extends FamilyMessageInput { id: string; createdAt: string }
export interface ElderReply { id: string; familyMessageId: string; audio: CompanionAudioRef; transcript: string; createdAt: string }
export interface DashboardMessage { senderName: string; text: string; createdAt: string; privateToFamily?: boolean }
export interface ElderContext { dailySummary: string; reminders: string[]; completedTasks: string[]; recentMessages: DashboardMessage[]; vitals: CompanionVital[]; history: FamilyMessage[]; activeMessage?: FamilyMessage; elderReplies: ElderReply[] }
interface StoreOptions { now?: () => Date; env?: Record<string, string | undefined>; historyLimit?: number }

const DEFAULT_REMINDERS = ['Tomar medicación de la mañana', 'Caminar 10 minutos acompañado']
const DEFAULT_COMPLETED_TASKS = ['Desayuno registrado', 'Control de presión completado']

function defaultVitals(now: string): CompanionVital[] {
  return [
    { kind: VITAL_KIND.BLOOD_PRESSURE, value: '128/82', unit: 'mmHg', measuredAt: now },
    { kind: VITAL_KIND.TEMPERATURE, value: 36.6, unit: '°C', measuredAt: now },
    { kind: VITAL_KIND.BLOOD_OXYGEN, value: 97, unit: '%', measuredAt: now },
    { kind: VITAL_KIND.PULSE, value: 74, unit: 'bpm', measuredAt: now },
  ]
}

export function normalizeAudio(input: CompanionAudioRef | undefined, fallbackId: string, source: typeof AUDIO_SOURCE.FAMILY_ORIGINAL | typeof AUDIO_SOURCE.ELDER_REPLY): CompanionAudioRef | undefined {
  if (!input) return undefined
  return { id: input.id || fallbackId, source, url: input.url || `/companion/media/${input.id || fallbackId}`, mimeType: input.mimeType || 'audio/webm', durationMs: input.durationMs }
}

export function createCompanionContextStore(options: StoreOptions = {}) {
  const messages: FamilyMessage[] = []
  const replies: ElderReply[] = []
  const now = options.now ?? (() => new Date())
  const historyLimit = options.historyLimit ?? 5

  return {
    createFamilyMessage(input: FamilyMessageInput): FamilyMessage {
      const id = `msg-${messages.length + 1}`
      const message: FamilyMessage = { id, senderName: input.senderName, text: input.text, audio: input.audio, createdAt: now().toISOString() }
      messages.push(message)
      return message
    },
    createElderReply(input: { familyMessageId: string; audio: CompanionAudioRef; transcript: string }): ElderReply {
      const reply: ElderReply = { id: `reply-${replies.length + 1}`, familyMessageId: input.familyMessageId, audio: input.audio, transcript: input.transcript, createdAt: now().toISOString() }
      replies.push(reply)
      return reply
    },
    buildElderContext(activeMessageId?: string): ElderContext {
      const activeMessage = activeMessageId ? messages.find((message) => message.id === activeMessageId) : undefined
      const measuredAt = now().toISOString()
      const history = messages.slice(-historyLimit)
      return {
        dailySummary: 'Día tranquilo con seguimiento familiar activo',
        reminders: DEFAULT_REMINDERS,
        completedTasks: DEFAULT_COMPLETED_TASKS,
        recentMessages: history.map((message) => ({ senderName: message.senderName, text: message.text, createdAt: message.createdAt })),
        vitals: defaultVitals(measuredAt),
        history,
        activeMessage,
        elderReplies: replies,
      }
    },
  }
}
