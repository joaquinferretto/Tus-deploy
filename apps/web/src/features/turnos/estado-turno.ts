import styles from '../directory/directory.module.css'

// Look of each state of a turno: pending is "waiting" (the orange of TUS), never the look of a
// confirmed one. The label comes from the shared contract (etiquetaEstadoTurno).
export const claseEstadoTurno = (estado: string): string =>
  `${styles.turnoState} ${estado === 'pending' || estado === 'awaiting_payment' ? styles.turnoStatePending : estado === 'confirmed' || estado === 'completed' ? styles.turnoStateOk : styles.turnoStateOff}`
