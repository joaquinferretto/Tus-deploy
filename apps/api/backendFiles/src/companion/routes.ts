import { Buffer } from 'node:buffer'
import { Router } from 'express'
import { AUDIO_SOURCE, COMPANION_EVENT_TYPE, COMPANION_ROLE, COMPANION_TARGET_VIEW, companionContextRouteParamsSchema, companionElderReplyRequestSchema, companionElderVoiceTurnRequestSchema, companionElderVoiceTurnResponseSchema, companionFamilyMessageRequestSchema, type CompanionScope } from '@repo/zod-schemas'
import { buildElderSafePromptPacket, createCompanionAiPorts, type CompanionAiPorts, type CompanionSpeechRef } from './ai-ports'
import { createCompanionContextStore, normalizeAudio } from './context'
import { publishCompanionEvent } from './event-hub'
import { CompanionMediaValidationError, getCompanionMedia, persistCompanionAudioRef, resetCompanionMediaStoreForTest, storeGeneratedCompanionSpeech } from './media-store'

export const companionStore = createCompanionContextStore()
let aiPorts = createCompanionAiPorts()

export function setCompanionAiPortsForTest(ports: CompanionAiPorts = createCompanionAiPorts()): void {
  aiPorts = ports
  resetCompanionMediaStoreForTest()
}

const TRANSCRIPTION_FAILURE_TEXT = 'No se pudo transcribir el audio. Puedes reproducirlo y reintentar la transcripción.'

type CompanionTranscriptResult = Awaited<ReturnType<CompanionAiPorts['transcribe']>>

export const companionRouter: Router = Router()

companionRouter.get('/companion/context/:role', (req, res) => {
  const parsed = companionContextRouteParamsSchema.safeParse(req.params)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid companion context role' })
    return
  }
  const context = companionStore.buildElderContext()
  res.json(parsed.data.role === COMPANION_ROLE.DOCTOR ? { reminders: context.reminders, vitals: context.vitals, elderReplies: context.elderReplies } : context)
})

companionRouter.get('/companion/media/:id', (req, res) => {
  const media = getCompanionMedia(req.params.id)
  if (!media) {
    res.status(404).json({ error: 'media not found' })
    return
  }
  res.type(media.metadata.mimeType).send(media.bytes)
})

companionRouter.post('/companion/family/messages', async (req, res) => {
  const parsed = companionFamilyMessageRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid family message payload' })
    return
  }
  const body = parsed.data
  const elderScope: CompanionScope = { ...body.scope, role: COMPANION_ROLE.ELDER }
  const senderName = body.senderName ?? 'Familia'
  const text = body.text ?? ''
  const normalizedFamilyAudio = normalizeAudio(body.audio ? { ...body.audio, source: body.audio.source ?? AUDIO_SOURCE.FAMILY_ORIGINAL } : undefined, `family-${Date.now()}`, AUDIO_SOURCE.FAMILY_ORIGINAL)
  let audio
  try { audio = normalizedFamilyAudio ? persistCompanionAudioRef(normalizedFamilyAudio) : undefined } catch (error) { return handleMediaError(error, res) }
  const message = companionStore.createFamilyMessage({ senderName, text, audio })
  const announcement = { text: `llegó un mensaje de ${senderName}` }
  const ttsAudio: CompanionSpeechRef | undefined = audio ? undefined : await aiPorts.synthesizeSpeech(text)
  let playableTtsAudio
  try { playableTtsAudio = ttsAudio ? persistProviderSpeech(ttsAudio) : undefined } catch { playableTtsAudio = undefined }
  const playbackAudio = audio ?? playableTtsAudio
  const playbackStatus = audio ? 'original-audio-ready' : playableTtsAudio ? 'tts-ready' : 'tts-unavailable'

  publishCompanionEvent({ ...elderScope, type: COMPANION_EVENT_TYPE.MESSAGE_CREATED, role: COMPANION_ROLE.ELDER, targetView: COMPANION_TARGET_VIEW.VOICE, messageId: message.id, text, timestamp: message.createdAt })
  publishCompanionEvent({ ...elderScope, type: COMPANION_EVENT_TYPE.ELDER_ANNOUNCEMENT_READY, role: COMPANION_ROLE.ELDER, targetView: COMPANION_TARGET_VIEW.VOICE, messageId: message.id, text: announcement.text, timestamp: message.createdAt })
  publishCompanionEvent({ ...elderScope, type: COMPANION_EVENT_TYPE.PLAYBACK_READY, role: COMPANION_ROLE.ELDER, targetView: COMPANION_TARGET_VIEW.VOICE, messageId: message.id, text, ...(playbackAudio ? { audio: playbackAudio } : {}), status: playbackStatus, timestamp: message.createdAt })

  res.status(201).json({ message, announcement, playback: { status: playbackStatus, ...(playbackAudio ? { audio: playbackAudio } : { tts: ttsAudio }) } })
})

companionRouter.post('/companion/elder/replies', async (req, res) => {
  const parsed = companionElderReplyRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid elder reply payload' })
    return
  }
  const body = parsed.data
  const familyScope: CompanionScope = { ...body.scope, role: COMPANION_ROLE.FAMILY }
  const doctorScope: CompanionScope = { ...body.scope, role: COMPANION_ROLE.DOCTOR }
  const familyMessageId = body.familyMessageId
  const normalizedReplyAudio = normalizeAudio({ ...body.audio, source: body.audio.source ?? AUDIO_SOURCE.ELDER_REPLY }, `elder-${Date.now()}`, AUDIO_SOURCE.ELDER_REPLY)
  let audio
  try { audio = normalizedReplyAudio ? persistCompanionAudioRef(normalizedReplyAudio) : undefined } catch (error) { return handleMediaError(error, res) }
  if (!audio) {
    res.status(400).json({ error: 'audio is required' })
    return
  }
  let transcript: CompanionTranscriptResult
  try {
    transcript = await aiPorts.transcribe(audio)
  } catch {
    transcript = { text: TRANSCRIPTION_FAILURE_TEXT, provider: 'groq', model: 'unavailable', status: 'unavailable' }
  }
  const text = transcript.status === 'unavailable' ? TRANSCRIPTION_FAILURE_TEXT : transcript.text
  const reply = companionStore.createElderReply({ familyMessageId, audio, transcript: text })

  if (transcript.status === 'unavailable') {
    publishCompanionEvent({ ...familyScope, type: COMPANION_EVENT_TYPE.TRANSCRIPTION_FAILED, role: COMPANION_ROLE.FAMILY, messageId: familyMessageId, text, audio, status: 'transcription_failed', timestamp: reply.createdAt })
    publishCompanionEvent({ ...doctorScope, type: COMPANION_EVENT_TYPE.TRANSCRIPTION_FAILED, role: COMPANION_ROLE.DOCTOR, messageId: familyMessageId, text, audio, status: 'transcription_failed', timestamp: reply.createdAt })
    res.status(202).json({ reply, status: 'transcription_failed' })
    return
  }

  publishCompanionEvent({ ...familyScope, type: COMPANION_EVENT_TYPE.ELDER_REPLY_RECEIVED, role: COMPANION_ROLE.FAMILY, messageId: familyMessageId, text: reply.transcript, audio, timestamp: reply.createdAt })
  publishCompanionEvent({ ...doctorScope, type: COMPANION_EVENT_TYPE.ELDER_REPLY_RECEIVED, role: COMPANION_ROLE.DOCTOR, messageId: familyMessageId, text: reply.transcript, audio, timestamp: reply.createdAt })
  res.status(201).json({ reply })
})

companionRouter.post('/companion/elder/voice-turn', async (req, res) => {
  const parsed = companionElderVoiceTurnRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid elder voice turn payload' })
    return
  }
  const body = parsed.data
  const elderScope: CompanionScope = { ...body.scope, role: COMPANION_ROLE.ELDER }
  const normalizedTurnAudio = normalizeAudio({ ...body.audio, source: body.audio.source ?? AUDIO_SOURCE.ELDER_REPLY }, `elder-turn-${Date.now()}`, AUDIO_SOURCE.ELDER_REPLY)
  let audio
  try { audio = normalizedTurnAudio ? persistCompanionAudioRef(normalizedTurnAudio) : undefined } catch (error) { return handleMediaError(error, res) }
  if (!audio) {
    res.status(400).json({ error: 'audio is required' })
    return
  }

  const readiness = aiPorts.readiness()
  const timestamp = new Date().toISOString()
  const transcript = await aiPorts.transcribe(audio)
  if (transcript.status === 'unavailable' || transcript.text.trim().length === 0) {
    const response = companionElderVoiceTurnResponseSchema.parse({
      status: 'failed',
      transcript: transcript.text.trim().length > 0 ? providerText(transcript) : undefined,
      readiness,
      error: { code: 'STT_UNAVAILABLE', message: 'No se pudo transcribir el audio de forma segura.' },
    })
    publishCompanionEvent({ ...elderScope, type: COMPANION_EVENT_TYPE.VOICE_TURN_FAILED, role: COMPANION_ROLE.ELDER, targetView: COMPANION_TARGET_VIEW.VOICE, messageId: audio.id, text: response.error?.message, status: response.error?.code, timestamp })
    res.status(503).json(response)
    return
  }

  const prompt = buildElderSafePromptPacket({ transcript: transcript.text, context: companionStore.buildElderContext(), safety: body.clientContext })
  const assistant = await aiPorts.createAssistantResponse(prompt)
  if (assistant.status === 'unavailable' || assistant.text.trim().length === 0) {
    const response = companionElderVoiceTurnResponseSchema.parse({
      status: 'failed',
      transcript: providerText(transcript),
      readiness,
      error: { code: 'LLM_UNAVAILABLE', message: 'No se pudo generar una respuesta segura.' },
    })
    publishCompanionEvent({ ...elderScope, type: COMPANION_EVENT_TYPE.VOICE_TURN_FAILED, role: COMPANION_ROLE.ELDER, targetView: COMPANION_TARGET_VIEW.VOICE, messageId: audio.id, text: response.error?.message, status: response.error?.code, timestamp })
    res.status(503).json(response)
    return
  }

  const speech = await aiPorts.synthesizeSpeech(assistant.text)
  let responseAudio
  try { responseAudio = speech.status === 'available' ? persistProviderSpeech(speech) : undefined } catch { responseAudio = undefined }
  const status = responseAudio ? 'completed' : 'tts_unavailable'
  const response = companionElderVoiceTurnResponseSchema.parse({
    status,
    transcript: providerText(transcript),
    assistant: providerText(assistant),
    ...(responseAudio ? { audio: responseAudio } : {}),
    tts: responseAudio ? { status: 'available' } : { status: 'unavailable', fallbackText: speech.fallbackText ?? assistant.text, code: speech.code ?? 'TTS_UNAVAILABLE' },
    readiness,
  })

  publishCompanionEvent({ ...elderScope, type: COMPANION_EVENT_TYPE.ASSISTANT_RESPONSE_READY, role: COMPANION_ROLE.ELDER, targetView: COMPANION_TARGET_VIEW.VOICE, messageId: audio.id, text: response.assistant?.text, transcript: response.transcript?.text, ...(response.audio ? { audio: response.audio } : {}), status, timestamp })
  res.status(responseAudio ? 201 : 202).json(response)
})

function handleMediaError(error: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): void {
  if (error instanceof CompanionMediaValidationError) {
    res.status(error.statusCode).json({ error: error.message })
    return
  }
  res.status(400).json({ error: 'invalid media payload' })
}

function persistProviderSpeech(ttsAudio: CompanionSpeechRef) {
  if (ttsAudio.status !== 'available' || !ttsAudio.id || !ttsAudio.bytes) return undefined
  return storeGeneratedCompanionSpeech(ttsAudio.id, Buffer.from(ttsAudio.bytes), ttsAudio.mimeType ?? 'audio/mpeg')
}

function providerText(result: CompanionTranscriptResult): { text: string; provider: string; model: string } {
  return { text: result.text, provider: result.provider, model: result.model }
}
