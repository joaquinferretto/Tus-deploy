'use client'

import { useState } from 'react'

import styles from './home.module.css'

// One field in plain words ("quiero un plomero", "no prende el aire", "plomero en Centro"). The
// home interprets it with the shared service search (the same one the TUS assistant uses).
export function HeroSearch({
  onSearch,
  busy,
}: {
  onSearch: (text: string) => void
  busy: boolean
}): React.ReactNode {
  const [text, setText] = useState('')
  return (
    <form
      aria-label="Buscar servicios"
      className={styles.search}
      onSubmit={(event) => {
        event.preventDefault()
        onSearch(text)
      }}
      role="search"
    >
      <label className={styles.srOnly} htmlFor="busqueda-servicio">
        ¿Qué necesitás?
      </label>
      <input
        autoComplete="off"
        className={styles.searchInput}
        id="busqueda-servicio"
        maxLength={200}
        onChange={(event) => setText(event.target.value)}
        placeholder="¿Qué necesitás? Ej.: se rompió una canilla, electricista en Centro"
        type="search"
        value={text}
      />
      <button className={`${styles.buttonPrimary} ${styles.searchButton}`} disabled={busy} type="submit">
        {busy ? 'Buscando…' : 'Buscar'}
      </button>
    </form>
  )
}
