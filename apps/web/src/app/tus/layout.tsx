import { TusSectionShell } from '@/components/layout/tus-section-shell'

export default function TusLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return <TusSectionShell>{children}</TusSectionShell>
}
