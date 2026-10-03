'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'

import styles from './home.module.css'

// The three steps of TUS: one text for the home section, the "¿Cómo funciona?" dialog of the
// header and the /como-funciona page.
export const HOW_IT_WORKS_STEPS = [
  { title: 'Contás qué necesitás', text: 'Buscá un servicio o publicá tu solicitud con fotos opcionales.' },
  { title: 'Elegís al profesional', text: 'Elegís un profesional del directorio o aceptás a quien se ofrezca para tu solicitud. Siempre decidís vos.' },
  { title: 'Pagás cuando está listo', text: 'Pagás el presupuesto aceptado con Mercado Pago cuando el trabajo termina.' },
] as const

export function HowItWorksSteps({ heading = 'h3' }: { heading?: 'h2' | 'h3' } = {}): React.ReactNode {
  const Heading = heading
  return (
    <ol className={styles.steps}>
      {HOW_IT_WORKS_STEPS.map((step, index) => (
        <li className={styles.step} key={step.title}>
          <span aria-hidden="true" className={styles.stepNumber}>{index + 1}</span>
          <Heading className={styles.stepTitle}>{step.title}</Heading>
          <p className={styles.rowText}>{step.text}</p>
        </li>
      ))}
    </ol>
  )
}

// Native <dialog>: showModal() traps the focus, Escape closes it and the focus goes back to the
// button that opened it. A click on the backdrop closes it too.
export function HowItWorksDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactNode {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      aria-labelledby="como-funciona-dialogo-titulo"
      className={styles.dialog}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      onClose={onClose}
      ref={ref}
    >
      <div className={styles.dialogBody}>
        <div className={styles.dialogHeader}>
          <h2 className={styles.sectionTitle} id="como-funciona-dialogo-titulo">¿Cómo funciona TUS?</h2>
          <button aria-label="Cerrar" className={styles.dialogClose} onClick={onClose} type="button">×</button>
        </div>
        <HowItWorksSteps />
        <div className={styles.dialogActions}>
          <Link className={styles.buttonSecondary} href="/asistente" onClick={onClose}>Tengo otra duda</Link>
          <Link className={styles.buttonPrimary} href="/" onClick={onClose}>Buscar un servicio</Link>
        </div>
      </div>
    </dialog>
  )
}
