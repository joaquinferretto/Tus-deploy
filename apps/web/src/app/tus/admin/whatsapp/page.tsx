import { AdminMfaGate } from '@/components/admin/admin-mfa-gate'
import { TusWhatsappAdminSurface } from './tus-whatsapp-admin'

export default function TusWhatsappAdminPage() {
  return (
    <AdminMfaGate returnTo="/tus/admin/whatsapp">
      <TusWhatsappAdminSurface />
    </AdminMfaGate>
  )
}
