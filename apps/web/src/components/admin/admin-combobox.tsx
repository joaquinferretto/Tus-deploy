'use client'

import { useEffect, useId, useRef, useState } from 'react'

import styles from './admin-usuarios.module.css'

// Search-as-you-type selector (a provider, a client): the person is found by name, the id never
// appears on screen. The options come from the API for the typed text.
export function AdminCombobox<T>({
  label,
  placeholder,
  minLength = 0,
  search,
  optionKey,
  optionLabel,
  optionDetail,
  value,
  onChange,
  disabled = false,
}: {
  label: string
  placeholder: string
  minLength?: number
  search: (text: string) => Promise<T[]>
  optionKey: (option: T) => string
  optionLabel: (option: T) => string
  optionDetail?: (option: T) => string
  value: T | null
  onChange: (value: T | null) => void
  disabled?: boolean
}): React.ReactNode {
  const id = useId()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<T[] | null>(null)
  const [active, setActive] = useState(0)
  const [failed, setFailed] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  // Latest search only: an older, slower answer never replaces a newer one.
  const latest = useRef(0)

  useEffect(() => {
    if (!open || value) return
    if (text.trim().length < minLength) {
      setOptions(null)
      return
    }
    const ticket = ++latest.current
    const timer = setTimeout(() => {
      search(text.trim())
        .then((items) => {
          if (ticket !== latest.current) return
          setOptions(items)
          setActive(0)
          setFailed(false)
        })
        .catch(() => {
          if (ticket !== latest.current) return
          setOptions([])
          setFailed(true)
        })
    }, 250)
    return () => clearTimeout(timer)
  }, [open, text, value, minLength, search])

  if (value)
    return (
      <div className={styles.field}>
        <span id={`${id}-label`}>{label}</span>
        <div aria-labelledby={`${id}-label`} className={styles.chosen} role="group">
          <span>
            <strong>{optionLabel(value)}</strong>
            {optionDetail ? <span className={styles.sub}>{optionDetail(value)}</span> : null}
          </span>
          <button
            className={styles.linkButton}
            disabled={disabled}
            onClick={() => {
              onChange(null)
              setText('')
              setOpen(true)
              setTimeout(() => input.current?.focus(), 0)
            }}
            type="button"
          >
            Cambiar
          </button>
        </div>
      </div>
    )

  const choose = (option: T) => {
    onChange(option)
    setOpen(false)
  }

  return (
    <div className={`${styles.field} ${styles.combo}`}>
      <label htmlFor={id}>{label}</label>
      <input
        aria-activedescendant={open && options?.[active] ? `${id}-option-${active}` : undefined}
        aria-autocomplete="list"
        aria-controls={`${id}-list`}
        aria-expanded={open}
        autoComplete="off"
        disabled={disabled}
        id={id}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(event) => {
          setText(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
            setActive((current) => Math.min(current + 1, Math.max((options?.length ?? 1) - 1, 0)))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((current) => Math.max(current - 1, 0))
          } else if (event.key === 'Enter' && open && options?.[active]) {
            event.preventDefault()
            choose(options[active])
          } else if (event.key === 'Escape') setOpen(false)
        }}
        placeholder={placeholder}
        ref={input}
        role="combobox"
        type="search"
        value={text}
      />
      {open ? (
        <ul className={styles.comboList} id={`${id}-list`} role="listbox">
          {options === null ? (
            <li className={styles.comboEmpty}>{text.trim().length < minLength ? `Escribí al menos ${minLength} letras` : 'Buscando…'}</li>
          ) : options.length === 0 ? (
            <li className={styles.comboEmpty}>{failed ? 'No pudimos buscar. Probá de nuevo.' : 'Sin resultados'}</li>
          ) : (
            options.map((option, index) => (
              <li
                aria-selected={index === active}
                className={styles.comboOption}
                id={`${id}-option-${index}`}
                key={optionKey(option)}
                // mousedown: chosen before the input loses focus and closes the list.
                onMouseDown={(event) => {
                  event.preventDefault()
                  choose(option)
                }}
                role="option"
              >
                <strong>{optionLabel(option)}</strong>
                {optionDetail ? <span className={styles.sub}>{optionDetail(option)}</span> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
