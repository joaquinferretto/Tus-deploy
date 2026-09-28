'use client'

import { useEffect, useRef, useState } from 'react'

import styles from './admin.module.css'

// Confirmation of a sensitive admin action (deactivate, suspend). A native <dialog> opened with
// showModal(): focus stays inside, Esc cancels, and nothing is applied until "confirm".
export interface ConfirmacionAdmin {
  titulo: string
  detalle: string
  confirmar: string
  onConfirm: () => void | Promise<unknown>
}

export function AdminConfirm({ value, onClose }: { value: ConfirmacionAdmin | null; onClose: () => void }): React.ReactNode {
  const ref = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (value && !dialog.open) dialog.showModal()
    if (!value && dialog.open) dialog.close()
  }, [value])

  async function confirmar() {
    if (!value || busy) return
    setBusy(true)
    try {
      await value.onConfirm()
    } finally {
      setBusy(false)
      onClose()
    }
  }

  return (
    <dialog aria-labelledby="admin-confirm-title" className={styles.confirmDialog} onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }} ref={ref}>
      {value ? (
        <>
          <h2 id="admin-confirm-title">{value.titulo}</h2>
          <p>{value.detalle}</p>
          <div className={styles.confirmActions}>
            <button className={styles.buttonSecondary} disabled={busy} onClick={onClose} type="button">Cancelar</button>
            <button className={styles.buttonDanger} disabled={busy} onClick={() => void confirmar()} type="button">{busy ? 'Aplicando…' : value.confirmar}</button>
          </div>
        </>
      ) : null}
    </dialog>
  )
}

// State helper: const [confirm, pedir, cerrar] = useConfirmacion()
export function useConfirmacion(): [ConfirmacionAdmin | null, (value: ConfirmacionAdmin) => void, () => void] {
  const [value, setValue] = useState<ConfirmacionAdmin | null>(null)
  return [value, setValue, () => setValue(null)]
}
