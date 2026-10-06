import { ProviderGate } from '@/features/session/provider-gate'

// Every /prestador screen: only for an account that can really be a provider, in provider mode
// (features/session/provider-gate.tsx). The API refuses the operations by itself.
export default function PrestadorLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return <ProviderGate>{children}</ProviderGate>
}
