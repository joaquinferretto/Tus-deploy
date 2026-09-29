// Real ratings of completed works (FASE 9), computed by the API. Never an invented value.
export function ratingLabel(rating: { average: number; count: number } | null): string | null {
  if (!rating || rating.count < 1) return null
  const average = rating.average.toFixed(1).replace('.', ',')
  return `★ ${average} · ${rating.count} ${rating.count === 1 ? 'calificación' : 'calificaciones'}`
}
