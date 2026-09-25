import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Image from 'next/image'

import styles from './brand.module.css'

// Official TUS logo, provided by the owner in apps/web/public/brand/ (logo-tus.png or
// tus-logo.png) and served from /brand/. It is never recreated in CSS: while the file is missing a
// plain "TUS" wordmark is rendered so the build and pages keep working.
export const TUS_LOGO_FILES = ['logo-tus.png', 'tus-logo.png'] as const

// Width follows the provided logo (1875x839, ~2.24:1); CSS keeps the real ratio with width:auto.
const SIZES = {
  header: { height: 36, width: 80 },
  auth: { height: 60, width: 134 },
} as const

function logoFile(): string | null {
  try {
    return TUS_LOGO_FILES.find((file) => existsSync(join(process.cwd(), 'public', 'brand', file))) ?? null
  } catch {
    return null
  }
}

export function TusLogo({ variant = 'header' }: { variant?: keyof typeof SIZES }): React.ReactNode {
  const size = SIZES[variant]
  const file = logoFile()
  if (!file)
    return (
      <span className={`${styles.wordmark} ${variant === 'auth' ? styles.wordmarkAuth : ''}`} aria-label="TUS">
        TUS
      </span>
    )
  return (
    <Image
      alt="TUS"
      className={styles.logo}
      height={size.height}
      priority={variant === 'header'}
      src={`/brand/${file}`}
      style={{ height: size.height, width: 'auto' }}
      width={size.width}
    />
  )
}
