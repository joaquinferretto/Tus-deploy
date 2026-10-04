import type { BloqueAyuda, EnLinea } from '@factory/contracts'

import styles from './help.module.css'

// A document rendered as React elements out of a tree of plain data. No HTML string is ever
// injected: text is text (React escapes it), so anything that looks like HTML in a document is
// shown as characters and never interpreted. Links were already validated
// when the tree was built (internal paths and https only).
function Linea({ nodos }: { nodos: EnLinea[] }): React.ReactNode {
  return nodos.map((nodo, indice) => {
    switch (nodo.tipo) {
      case 'texto':
        return nodo.texto
      case 'fuerte':
        return <strong key={indice}><Linea nodos={nodo.hijos} /></strong>
      case 'enfasis':
        return <em key={indice}><Linea nodos={nodo.hijos} /></em>
      case 'codigo':
        return <code className={styles.code} key={indice}>{nodo.texto}</code>
      case 'enlace':
        return nodo.externo ? (
          <a href={nodo.href} key={indice} rel="noopener noreferrer" target="_blank"><Linea nodos={nodo.hijos} /></a>
        ) : (
          <a href={nodo.href} key={indice}><Linea nodos={nodo.hijos} /></a>
        )
    }
  })
}

export function HelpArticleBody({ bloques }: { bloques: BloqueAyuda[] }): React.ReactNode {
  return (
    <div className={styles.body}>
      {bloques.map((bloque, indice) => {
        switch (bloque.tipo) {
          case 'titulo': {
            const Titulo = bloque.nivel === 2 ? 'h2' : bloque.nivel === 3 ? 'h3' : 'h4'
            return <Titulo id={bloque.id} key={indice}><Linea nodos={bloque.hijos} /></Titulo>
          }
          case 'parrafo':
            return <p key={indice}><Linea nodos={bloque.hijos} /></p>
          case 'cita':
            return <blockquote key={indice}><Linea nodos={bloque.hijos} /></blockquote>
          case 'lista': {
            const Lista = bloque.ordenada ? 'ol' : 'ul'
            return <Lista key={indice}>{bloque.items.map((item, posicion) => <li key={posicion}><Linea nodos={item} /></li>)}</Lista>
          }
        }
      })}
    </div>
  )
}
