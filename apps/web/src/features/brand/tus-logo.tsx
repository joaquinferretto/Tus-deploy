import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Image from 'next/image'

import styles from './brand.module.css'

// Official TUS logo, provided by the owner at apps/web/public/brand/tus-logo.png and served as
// /brand/tus-logo.png. It is never recreated in CSS: while the file is missing a plain "TUS"
// wordmark is rendered so the build and pages keep working.
export const TUS_LOGO_PATH = '/brand/tus-logo.png'

const SIZES = {
  header: { height: 36, width: 108 },
  auth: { height: 60, width: 180 },
} as const

function logoFileExists(): boolean {
  try {
    return existsSync(join(process.cwd(), 'public', 'brand', 'tus-logo.png'))
  } catch {
    return false
  }
}

export function TusLogo({ variant = 'header' }: { variant?: keyof typeof SIZES }): React.ReactNode {
  const size = SIZES[variant]
  if (!logoFileExists())
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
      src={TUS_LOGO_PATH}
      style={{ height: size.height, width: 'auto' }}
      width={size.width}
    />
  )
}
