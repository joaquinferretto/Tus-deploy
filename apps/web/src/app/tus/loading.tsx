import { TusStateMessage } from './tus-ui'

export default function TusLoading(): React.ReactNode {
  return (
    <TusStateMessage
      state={{ status: 'loading', resource: 'TUS workspace', message: 'Loading the TUS workspace…' }}
    />
  )
}
