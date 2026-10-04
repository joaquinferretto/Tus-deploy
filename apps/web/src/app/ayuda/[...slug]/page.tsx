import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { rutaDeArticulo } from '@factory/contracts'

import { TusLogo } from '@/features/brand/tus-logo'
import { HelpAccountStatus } from '@/features/help/help-account-status'
import { HelpArticleBody } from '@/features/help/help-article'
import { ACCIONES_AYUDA, PORTADA_PRESTADORES, articulo, articulosDePrestador, tituloDeCategoria } from '@/features/help/help-content'
import styles from '@/features/help/help.module.css'
import { SitePage } from '@/features/home/site-page'

type Parametros = { params: Promise<{ slug: string[] }> }

const slugDe = (partes: string[]): string => partes.join('/')

export async function generateMetadata({ params }: Parametros): Promise<Metadata> {
  const slug = slugDe((await params).slug)
  if (slug === PORTADA_PRESTADORES)
    return { title: 'Manual del prestador | Ayuda TUS', description: 'Cómo configurar tu perfil, tus servicios, tu disponibilidad, Mercado Pago y tus ganancias en TUS.', alternates: { canonical: '/ayuda/prestadores' } }
  const item = articulo(slug)
  if (!item) return { title: 'Ayuda | TUS', robots: { index: false, follow: false } }
  return { title: `${item.titulo} | Ayuda TUS`, description: item.descripcion, alternates: { canonical: rutaDeArticulo(item.slug) } }
}

function Migas({ pasos }: { pasos: { texto: string; href?: string }[] }): React.ReactNode {
  return (
    <nav aria-label="Ruta de navegación" className={styles.crumbs}>
      <ol>
        {pasos.map((paso) => (
          <li key={paso.texto}>{paso.href ? <a href={paso.href}>{paso.texto}</a> : <span aria-current="page">{paso.texto}</span>}</li>
        ))}
      </ol>
    </nav>
  )
}

// The cover of the provider manual: one page, every section of the manual in its order.
function PortadaPrestadores(): React.ReactNode {
  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <article className={styles.wrap}>
        <Migas pasos={[{ texto: 'Ayuda', href: '/ayuda' }, { texto: 'Prestadores' }]} />
        <h1 className={styles.title}>Manual del prestador</h1>
        <p className={styles.lead}>Todo lo que necesitás para ofrecer tus servicios en TUS, en el orden en que conviene configurarlo.</p>
        <ul className={styles.list}>
          {articulosDePrestador().map((item) => (
            <li className={styles.item} key={item.slug}>
              <a href={rutaDeArticulo(item.slug)}>
                <span className={styles.itemTitle}>{item.titulo}</span>
                <span className={styles.itemText}>{item.descripcion}</span>
              </a>
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <a className={styles.primary} href="/prestador/solicitudes">Ir a mi panel</a>
          <a className={styles.secondary} href="/ayuda">Volver a Ayuda</a>
        </div>
      </article>
    </SitePage>
  )
}

export default async function HelpArticlePage({ params }: Parametros): Promise<React.ReactNode> {
  const slug = slugDe((await params).slug)
  if (slug === PORTADA_PRESTADORES) return <PortadaPrestadores />
  const item = articulo(slug)
  if (!item) notFound()

  const dePrestador = item.categoria === 'prestadores'
  const siguiente = item.siguiente ? articulo(item.siguiente) : null
  const accion = ACCIONES_AYUDA[item.slug]
  const secciones = item.bloques.filter((bloque) => bloque.tipo === 'titulo' && bloque.nivel === 2)

  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <article className={styles.wrap}>
        <Migas
          pasos={[
            { texto: 'Ayuda', href: '/ayuda' },
            dePrestador ? { texto: 'Prestadores', href: rutaDeArticulo(PORTADA_PRESTADORES) } : { texto: tituloDeCategoria(item.categoria), href: '/ayuda' },
            { texto: item.titulo },
          ]}
        />
        <h1 className={styles.title}>{item.titulo}</h1>
        <p className={styles.lead}>{item.descripcion}</p>
        {/* Private state, read by the browser of the signed-in person. Never part of this HTML. */}
        {item.slug === 'verificar-celular' || item.slug === 'vincular-whatsapp' ? <HelpAccountStatus guia={item.slug} /> : null}
        {secciones.length >= 3 ? (
          <nav aria-label="En esta página" className={styles.toc}>
            <p className={styles.tocTitle}>En esta página</p>
            <ul>
              {secciones.map((bloque) => (bloque.tipo === 'titulo' ? <li key={bloque.id}><a href={`#${bloque.id}`}>{bloque.texto}</a></li> : null))}
            </ul>
          </nav>
        ) : null}
        <HelpArticleBody bloques={item.bloques} />
        {siguiente ? (
          <p className={styles.next}>Siguiente paso: <a href={rutaDeArticulo(siguiente.slug)}>{siguiente.titulo}</a></p>
        ) : null}
        <div className={styles.actions}>
          {accion ? <a className={styles.primary} href={accion.href}>{accion.etiqueta}</a> : null}
          <a className={styles.secondary} href={dePrestador ? rutaDeArticulo(PORTADA_PRESTADORES) : '/ayuda'}>{dePrestador ? 'Volver al manual' : 'Volver a Ayuda'}</a>
        </div>
        {item.actualizado ? <p className={styles.updated}>Actualizado el {item.actualizado.split('-').reverse().join('/')}</p> : null}
      </article>
    </SitePage>
  )
}
