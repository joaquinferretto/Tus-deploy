import { AdminMfaGate } from '@/components/admin/admin-mfa-gate'
import { PrestadoresAdmin } from '@/components/admin/prestadores-admin'

export default function PrestadoresAdminPage() {
  return <AdminMfaGate returnTo="/tus/admin/prestadores"><PrestadoresAdmin /></AdminMfaGate>
}
