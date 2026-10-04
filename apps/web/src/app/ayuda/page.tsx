import type { Metadata } from 'next'

import { CATEGORIAS_AYUDA, buscarAyuda, rutaDeArticulo } from '@factory/contracts'

import { TusLogo } from '@/features/brand/tus-logo'
import { PORTADA_PRESTADORES, articulos, tituloDeCategoria } from '@/features/help/help-content'
import styles from '@/features/help/help.module.css'
import { SitePage } from '@/features/home/site-page'

// The Help Center: public knowledge only. The search is deterministic and runs here, over the
// same articles (no model, no network). A page with a query is the same public content filtered,
// so it is not indexed; the plain cover is.
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }): Promise<Metadata> {
  const { q } = await searchParams
  return {
    title: 'Ayuda | TUS',
    description: 'Guías de TUS: registro, celular y WhatsApp, solicitudes, turnos, pagos y el manual del prestador.',
    alternates: { canonical: '/ayuda' },
    ...(q ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function HelpPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }): Promise<React.ReactNode> {
  const { q } = await searchParams
  const consulta = (Array.isArray(q) ? q[0] : q)?.slice(0, 120).trim() ?? ''
  const todos = articulos()
  const resultados = consulta ? buscarAyuda(todos, consulta) : []

  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <div className={styles.wrap}>
        <section aria-labelledby="ayuda-titulo" className={styles.hero}>
          <h1 className={styles.heroTitle} id="ayuda-titulo">¿Cómo podemos ayudarte?</h1>
          <form action="/ayuda" className={styles.search} method="get" role="search">
            <input aria-label="Buscar en Ayuda" autoComplete="off" className={styles.searchInput} defaultValue={consulta} maxLength={120} name="q" placeholder="Buscar en Ayuda" type="search" />
            <button className={styles.searchButton} type="submit">Buscar</button>
          </form>
        </section>

        {consulta ? (
          <section aria-labelledby="ayuda-resultados" className={styles.category}>
            <h2 className={styles.categoryTitle} id="ayuda-resultados">Resultados para “{consulta}”</h2>
            {resultados.length === 0 ? (
              <p className={styles.empty}>No encontramos una guía para eso. Probá con otras palabras o mirá las categorías de abajo.</p>
            ) : (
              <ul className={styles.list}>
                {resultados.map((resultado) => (
                  <li className={styles.item} key={resultado.slug}>
                    <a href={rutaDeArticulo(resultado.slug)}>
                      <span className={styles.itemTitle}>{resultado.titulo}</span>
                      <span className={styles.itemText}>{resultado.descripcion}</span>
                      <span className={styles.itemTag}>{tituloDeCategoria(resultado.categoria)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <nav aria-label="Categorías de ayuda">
          {CATEGORIAS_AYUDA.map((categoria) => {
            const propios = todos.filter((item) => item.categoria === categoria.id)
            if (propios.length === 0) return null
            // The manual of the provider has its own cover: one entry here, the rest from there.
            if (categoria.id === 'prestadores')
              return (
                <section aria-labelledby="ayuda-prestadores" className={styles.category} key={categoria.id}>
                  <h2 className={styles.categoryTitle} id="ayuda-prestadores">{categoria.titulo}</h2>
                  <ul className={styles.list}>
                    <li className={styles.item}>
                      <a href={rutaDeArticulo(PORTADA_PRESTADORES)}>
                        <span className={styles.itemTitle}>Manual del prestador</span>
                        <span className={styles.itemText}>Perfil público, servicios, disponibilidad, solicitudes, turnos, Mercado Pago y ganancias.</span>
                      </a>
                    </li>
                  </ul>
                </section>
              )
            return (
              <section aria-labelledby={`ayuda-${categoria.id}`} className={styles.category} key={categoria.id}>
                <h2 className={styles.categoryTitle} id={`ayuda-${categoria.id}`}>{categoria.titulo}</h2>
                <ul className={styles.list}>
                  {propios.map((item) => (
                    <li className={styles.item} key={item.slug}>
                      <a href={rutaDeArticulo(item.slug)}>
                        <span className={styles.itemTitle}>{item.titulo}</span>
                        <span className={styles.itemText}>{item.descripcion}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </nav>
      </div>
    </SitePage>
  )
}
