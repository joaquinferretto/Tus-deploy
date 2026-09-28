'use client'

import { useEffect, useState } from 'react'

import { adminApi, adminErrorMessage, type AdminCatalogo } from '@/lib/tus-admin-api'
import { AdminEmpty, AdminPageHeader } from './admin-layout'
import styles from './admin.module.css'

function useCatalogo() {
  const [data, setData] = useState<AdminCatalogo | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    adminApi.catalogo().then(setData).catch((cause) => setError(adminErrorMessage(cause)))
  }, [])
  return { data, error }
}

// Trades as the search understands them. The catalog lives in code (apps/api/src/tus/directorio/
// oficios.ts), not in the database: this view shows it read-only; changing it is a code change.
export function AdminServicios(): React.ReactNode {
  const { data, error } = useCatalogo()
  return (
    <>
      <AdminPageHeader subtitle="Oficios que reconoce la búsqueda y las palabras que llevan a cada uno" title="Servicios" />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {!data && !error ? <p className={styles.muted} role="status">Cargando el catálogo…</p> : null}
      {data ? (
        <>
          <ul className={styles.list}>
            {data.oficios.map((item) => (
              <li className={styles.listItem} key={item.id} style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{item.label}</strong> <span className={styles.muted}>· {item.profesion}</span>
                  <div className={styles.keywords}>
                    {item.palabrasClave.map((word) => <span key={word}>{word}</span>)}
                  </div>
                </div>
                <span className={styles.muted} style={{ whiteSpace: 'nowrap' }}>{item.prestadores} prestadores · {item.enMapa} en el mapa</span>
              </li>
            ))}
          </ul>
          <p className={styles.muted} style={{ marginTop: 12 }}>
            Cerrajería, albañilería, carpintería, jardinería y mudanzas están agrupadas en <strong>Otros</strong>: comparten ícono y filtro.
            El catálogo está definido en el código del servidor; para separarlos o sumar un oficio hay que cambiarlo ahí.
          </p>
        </>
      ) : null}
    </>
  )
}

export function AdminZonas(): React.ReactNode {
  const { data, error } = useCatalogo()
  return (
    <>
      <AdminPageHeader subtitle="Barrios que reconoce la búsqueda y ubica el mapa" title="Zonas" />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {!data && !error ? <p className={styles.muted} role="status">Cargando zonas…</p> : null}
      {data && data.zonas.length === 0 ? <AdminEmpty text="No hay zonas cargadas." /> : null}
      {data && data.zonas.length > 0 ? (
        <>
          <table className={styles.table}>
            <thead>
              <tr><th>Zona</th><th>Estado</th><th>Prestadores</th></tr>
            </thead>
            <tbody>
              {data.zonas.map((zona) => (
                <tr key={zona.nombre}>
                  <td data-label="Zona"><strong>{zona.nombre}</strong></td>
                  <td data-label="Estado"><span className={`${styles.badge} ${styles.badgeOk}`}>Reconocida</span></td>
                  <td data-label="Prestadores">{zona.prestadores}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.muted} style={{ marginTop: 12 }}>
            Un barrio que no está en esta lista (por ejemplo Ponce) no se reconoce en la búsqueda ni se ubica en el mapa. Las zonas y sus
            coordenadas aproximadas están definidas en el código del servidor.
          </p>
        </>
      ) : null}
    </>
  )
}
