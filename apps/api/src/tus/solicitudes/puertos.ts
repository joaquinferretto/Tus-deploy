import type { CategoriaSolicitud, SolicitudServicio } from './modelo.ts'

export interface AlmacenSolicitudes {
  guardar(solicitud: SolicitudServicio): Promise<void>
  // Abiertas y vigentes, más recientes primero.
  listarAbiertas(input: { ahora: number; categoria?: CategoriaSolicitud; limite: number }): Promise<SolicitudServicio[]>
  listarDeCuenta(cuentaId: string): Promise<SolicitudServicio[]>
  contarPublicadasDesde(cuentaId: string, desde: number): Promise<number>
  contarAbiertas(cuentaId: string, ahora: number): Promise<number>
  // Solo la dueña puede cerrar; devuelve false si no existe, no es suya o ya estaba cerrada.
  cerrar(input: { id: string; cuentaId: string; ahora: number }): Promise<boolean>
}

export interface CuentasSolicitudes {
  getAccount(accountId: string): Promise<{ displayName: string; status: string; emailVerifiedAt: number | null } | undefined>
}
