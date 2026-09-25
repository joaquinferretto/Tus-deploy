import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  crearPoolCredencialesGroq,
  GroqCredentialPoolUnavailableError,
} from '../../apps/api/src/providers/groq/index.ts'
import { GroqChatProvider, TranscriptorGroq } from '../../apps/api/src/tus/asistente/groq.ts'
import { ModeloVisionGroq } from '../../apps/api/src/tus/identidad/lectores.ts'

const URL = 'https://api.groq.com/openai/v1/chat/completions'

function okResponse() {
  return new Response('{}', { status: 200 })
}

function request(pool) {
  return pool.request({
    url: URL,
    idempotent: true,
    createInit: () => ({ method: 'POST', body: '{}' }),
  })
}

function authFrom(init) {
  return new Headers(init.headers).get('authorization')
}

test('configura de una a seis keys numeradas y prioriza el pool sobre la legacy', () => {
  for (let count = 1; count <= 6; count += 1) {
    const env = Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`GROQ_API_KEY_${index + 1}`, `key-${index + 1}`])
    )
    const pool = crearPoolCredencialesGroq(env)
    assert.ok(pool)
    assert.deepEqual(
      pool.metadata().map(({ identifier }) => identifier),
      Array.from({ length: count }, (_, index) => `groq-${index + 1}`)
    )
  }

  const prioritized = crearPoolCredencialesGroq({
    GROQ_API_KEY: 'legacy',
    GROQ_API_KEY_2: 'numbered',
  })
  assert.ok(prioritized)
  assert.deepEqual(
    prioritized.metadata().map(({ identifier }) => identifier),
    ['groq-2']
  )
})

test('usa la key legacy cuando no existen keys numeradas', () => {
  const pool = crearPoolCredencialesGroq({ GROQ_API_KEY: 'legacy' })
  assert.ok(pool)
  assert.deepEqual(
    pool.metadata().map(({ identifier }) => identifier),
    ['groq-1']
  )
})

test('selecciona round-robin y mantiene la secuencia bajo concurrencia', async () => {
  const selected = []
  const pool = crearPoolCredencialesGroq(
    { GROQ_API_KEY_1: 'key-one', GROQ_API_KEY_2: 'key-two', GROQ_API_KEY_3: 'key-three' },
    {
      fetch: async (_url, init) => {
        selected.push(authFrom(init))
        await new Promise((resolve) => setTimeout(resolve, 1))
        return okResponse()
      },
    }
  )
  assert.ok(pool)

  await Promise.all(Array.from({ length: 12 }, () => request(pool)))

  assert.deepEqual(selected, [
    'Bearer key-one',
    'Bearer key-two',
    'Bearer key-three',
    'Bearer key-one',
    'Bearer key-two',
    'Bearer key-three',
    'Bearer key-one',
    'Bearer key-two',
    'Bearer key-three',
    'Bearer key-one',
    'Bearer key-two',
    'Bearer key-three',
  ])
  assert.deepEqual(
    pool.metadata().map(({ requestCount }) => requestCount),
    [4, 4, 4]
  )
})

test('marca la key fallida en cooldown, respeta Retry-After y hace un solo fallback', async () => {
  let now = 1_000
  const selected = []
  let calls = 0
  const pool = crearPoolCredencialesGroq(
    { GROQ_API_KEY_1: 'key-one', GROQ_API_KEY_2: 'key-two' },
    {
      now: () => now,
      fetch: async (_url, init) => {
        selected.push(authFrom(init))
        calls += 1
        return calls === 1
          ? new Response('{}', {
              status: 429,
              headers: { 'retry-after': '10', 'x-groq-rate-limit-scope': 'key' },
            })
          : okResponse()
      },
    }
  )
  assert.ok(pool)

  await request(pool)
  assert.deepEqual(selected, ['Bearer key-one', 'Bearer key-two'])
  assert.deepEqual(pool.metadata()[0], {
    identifier: 'groq-1',
    healthy: false,
    cooldownUntil: 11_000,
    lastErrorCode: 'RATE_LIMITED',
    requestCount: 1,
  })

  await request(pool)
  assert.equal(selected[2], 'Bearer key-two')
  now = 11_000
  await request(pool)
  assert.equal(selected[3], 'Bearer key-one')
})

test('no evade una cuota global: un 429 bloquea el pool y no prueba una segunda key', async () => {
  let now = 1_000
  let calls = 0
  const pool = crearPoolCredencialesGroq(
    { GROQ_API_KEY_1: 'key-one', GROQ_API_KEY_2: 'key-two' },
    {
      now: () => now,
      fetch: async () => {
        calls += 1
        return new Response('{}', { status: 429, headers: { 'retry-after': '10' } })
      },
    }
  )
  assert.ok(pool)

  const first = await request(pool)
  assert.equal(first.status, 429)
  assert.equal(calls, 1)
  await assert.rejects(request(pool), (error) => {
    assert.ok(error instanceof GroqCredentialPoolUnavailableError)
    assert.equal(error.retryAfterMs, 10_000)
    return true
  })
  assert.equal(calls, 1)
  now = 11_000
  const next = await request(pool)
  assert.equal(next.status, 429)
  assert.equal(calls, 2)
})

test('trata la capacidad Flex 498 como límite global y no rota a otra key', async () => {
  let calls = 0
  const pool = crearPoolCredencialesGroq(
    { GROQ_API_KEY_1: 'key-one', GROQ_API_KEY_2: 'key-two' },
    {
      fetch: async () => {
        calls += 1
        return new Response('{}', { status: 498, headers: { 'retry-after': '3' } })
      },
    }
  )
  assert.ok(pool)

  const first = await request(pool)
  assert.equal(first.status, 498)
  assert.equal(calls, 1)
  await assert.rejects(request(pool), GroqCredentialPoolUnavailableError)
  assert.equal(calls, 1)
})

test('un error transitorio también permite un solo fallback y no repite side effects', async () => {
  const selected = []
  let now = 1_000
  const pool = crearPoolCredencialesGroq(
    { GROQ_API_KEY_1: 'key-one', GROQ_API_KEY_2: 'key-two' },
    {
      now: () => now,
      fetch: async (_url, init) => {
        selected.push(authFrom(init))
        return selected.length === 1
          ? new Response('{}', { status: 503, headers: { 'retry-after': '4' } })
          : okResponse()
      },
    }
  )
  assert.ok(pool)

  await request(pool)
  assert.deepEqual(selected, ['Bearer key-one', 'Bearer key-two'])
  assert.equal(pool.metadata()[0].lastErrorCode, 'TRANSIENT')
  assert.equal(pool.metadata()[0].cooldownUntil, now + 4_000)
})

test('cuando ambas keys no están disponibles no hay loops ni tercer intento', async () => {
  let calls = 0
  const pool = crearPoolCredencialesGroq(
    { GROQ_API_KEY_1: 'key-one', GROQ_API_KEY_2: 'key-two' },
    {
      fetch: async () => {
        calls += 1
        return new Response('{}', { status: 401 })
      },
    }
  )
  assert.ok(pool)

  const first = await request(pool)
  assert.equal(first.status, 401)
  assert.equal(calls, 2)

  await assert.rejects(request(pool), (error) => {
    assert.ok(error instanceof GroqCredentialPoolUnavailableError)
    assert.doesNotMatch(error.message, /key-one|key-two/u)
    return true
  })
  assert.equal(calls, 2)
})

test('sin ninguna key conserva el error de configuración y nunca filtra secretos', async () => {
  assert.equal(crearPoolCredencialesGroq({}), null)
  assert.throws(() => new GroqChatProvider({}), /GROQ_API_KEY/u)

  const logs = []
  const pool = crearPoolCredencialesGroq(
    { GROQ_API_KEY_1: 'key-one', GROQ_API_KEY_2: 'key-two' },
    { fetch: async () => okResponse(), log: (message) => logs.push(message) }
  )
  assert.ok(pool)
  await request(pool)
  assert.match(logs.join(' '), /groq credential groq-1 selected/u)
  assert.doesNotMatch(logs.join(' '), /key-one|key-two/u)
  assert.doesNotMatch(JSON.stringify(pool.metadata()), /key-one|key-two/u)
})

test('rechaza en runtime cualquier request que no declare idempotencia', async () => {
  const pool = crearPoolCredencialesGroq({ GROQ_API_KEY_1: 'key-one' })
  assert.ok(pool)
  await assert.rejects(
    pool.request({ url: URL, idempotent: false, createInit: () => ({ method: 'POST' }) }),
    /idempotent/u
  )
})

test('chat, transcripción y visión comparten el mismo pool sin recibir ninguna key', async () => {
  const selected = []
  const pool = crearPoolCredencialesGroq(
    { GROQ_API_KEY_1: 'key-one', GROQ_API_KEY_2: 'key-two' },
    {
      fetch: async (url, init) => {
        selected.push({ url: String(url), auth: authFrom(init) })
        if (String(url).includes('/audio/transcriptions'))
          return new Response(JSON.stringify({ text: 'audio transcripto' }), { status: 200 })
        if (selected.length === 3)
          return new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: 'stop',
                  message: {
                    content: JSON.stringify({
                      legible: true,
                      document_number: '30111222',
                      first_name: 'JUAN',
                      last_name: 'PRUEBA',
                      birth_date: null,
                      sex: 'M',
                      nationality: 'ARG',
                      expiration_date: null,
                      confidence: 0.9,
                    }),
                  },
                },
              ],
            }),
            { status: 200 }
          )
        return new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: 'respuesta' } }],
          }),
          { status: 200 }
        )
      },
    }
  )
  assert.ok(pool)

  const chat = new GroqChatProvider({ pool })
  const transcriptor = new TranscriptorGroq({ pool })
  const vision = new ModeloVisionGroq({ pool })
  const answer = await chat.chat({ messages: [{ role: 'user', content: 'hola' }], maxTokens: 20 })
  const text = await transcriptor.transcribir({
    bytes: Buffer.from('audio'),
    mimeType: 'audio/ogg',
  })
  const reading = await vision.extraer([
    { side: 'front', mimeType: 'image/png', bytes: Buffer.from('front') },
  ])

  assert.equal(answer.content, 'respuesta')
  assert.equal(text, 'audio transcripto')
  assert.equal(reading.document_number, '30111222')
  assert.deepEqual(
    selected.map(({ auth }) => auth),
    ['Bearer key-one', 'Bearer key-two', 'Bearer key-one']
  )
})
