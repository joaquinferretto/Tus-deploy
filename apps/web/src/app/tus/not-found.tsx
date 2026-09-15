import Link from 'next/link'

import { TusStateMessage } from './tus-ui'

export default function TusNotFound(): React.ReactNode {
  return (
    <TusStateMessage
      state={{
        status: 'empty',
        resource: 'TUS workspace',
        message: 'The requested TUS workspace page was not found.',
      }}
    >
      <Link className="tus-action-button tus-action-link" href="/tus">
        Return to workspace
      </Link>
    </TusStateMessage>
  )
}
