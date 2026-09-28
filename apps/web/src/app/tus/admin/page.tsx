import { AdminMfaGate } from '@/components/admin/admin-mfa-gate'
import { AdminHome } from '@/components/admin/admin-home'

export default function TusAdminPage() {
  return (
    <AdminMfaGate returnTo="/tus/admin">
      <AdminHome />
    </AdminMfaGate>
  )
}
