'use client'

import { TusStateMessage } from './tus-ui'

export default function TusError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): React.ReactNode {
  return (
    <TusStateMessage
      state={{
        status: 'error',
        resource: 'TUS workspace',
        message: 'The TUS workspace could not be rendered. Try again for a fresh response.',
        retry: reset,
      }}
    />
  )
}
