import { redirect } from 'next/navigation'

export default async function LegacySignInRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item))
    else if (value !== undefined) query.set(key, value)
  }
  const suffix = query.toString()
  redirect(suffix.length > 0 ? `/sign-in?${suffix}` : '/sign-in')
}
