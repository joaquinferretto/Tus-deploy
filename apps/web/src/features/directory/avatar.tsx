'use client'

import { useState } from 'react'

import { apiUrl } from './directory-client'
import styles from './directory.module.css'

// Profile photo of a provider, or its initials when there is none or it fails to load. The photo
// is only ever read from the TUS API (a path the API itself returned); any other value is ignored.
export function Avatar({ initials, photoUrl, size = 'md' }: { initials: string; photoUrl?: string | null; size?: 'sm' | 'md' | 'lg' }): React.ReactNode {
  const [failed, setFailed] = useState(false)
  const src = photoUrl && !failed ? apiUrl(photoUrl) : ''
  const sizeClass = size === 'sm' ? styles.avatarSm : size === 'lg' ? styles.avatarLarge : ''
  return (
    <span aria-hidden="true" className={`${styles.avatar} ${sizeClass}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- served by the API with its own cache headers
        <img alt="" className={styles.avatarImage} decoding="async" loading="lazy" onError={() => setFailed(true)} src={src} />
      ) : (
        initials
      )}
    </span>
  )
}
