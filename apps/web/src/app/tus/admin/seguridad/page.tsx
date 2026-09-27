import { AdminMfaGate } from '@/components/admin/admin-mfa-gate'
import { SeguridadAdmin } from '@/components/admin/seguridad-admin'

export default function TusAdminSeguridadPage() {
  return (
    <AdminMfaGate returnTo="/tus/admin/seguridad">
      <SeguridadAdmin />
    </AdminMfaGate>
  )
}
