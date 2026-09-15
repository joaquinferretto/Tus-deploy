import { TusAppShell } from '@/components/layout/tus-app-shell'

export default function TusLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return <TusAppShell>{children}</TusAppShell>
}
