import { AdminMfaGate } from '@/components/admin/admin-mfa-gate'
import { VerificacionesIdentidadAdmin } from '@/components/admin/verificaciones-identidad'

export default function TusAdminIdentidadPage() {
  return (
    <AdminMfaGate returnTo="/tus/admin/identidad">
      <VerificacionesIdentidadAdmin />
    </AdminMfaGate>
  )
}
