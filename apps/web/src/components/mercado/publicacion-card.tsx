import { formatTusCurrency, type TusCatalogFacts } from '@/lib/tus-journeys'
import type { TusMarketplaceDiscoveryItem } from '@/lib/tus-client'
import { TusActionButton } from '../../app/tus/tus-ui'

export interface PublicacionCardCopy {
  typeLabel: string
  availability: string
  policy: string
  actionLabel: string
  detailLabel?: string
  prestadorLabel?: string
}

export function PublicacionCard({
  publicacion,
  copy,
  facts,
  kicker,
  detailHref,
  onCheckout,
  checkoutLoading = false,
}: {
  publicacion: TusMarketplaceDiscoveryItem
  copy: PublicacionCardCopy
  facts?: TusCatalogFacts
  kicker?: string
  detailHref?: string
  onCheckout?: () => void
  checkoutLoading?: boolean
}): React.ReactNode {
  const availability = facts?.availability ?? copy.availability
  return (
    <article className="tus-offer-card tus-publicacion-card" data-kind={publicacion.kind}>
      <div className="tus-card-kicker">{kicker ?? facts?.context ?? copy.typeLabel}</div>
      <h3>
        {detailHref === undefined ? (
          publicacion.name
        ) : (
          <a href={detailHref}>{publicacion.name}</a>
        )}
      </h3>
      <p>{publicacion.description}</p>
      <div className="tus-offer-meta">
        <strong>{facts?.price ?? formatTusCurrency(publicacion.price, publicacion.currency)}</strong>
        <span>{availability}</span>
      </div>
      <div className="tus-publicacion-facts">
        <span>{copy.typeLabel}</span>
        {copy.prestadorLabel === undefined ? null : (
          <span>
            {copy.prestadorLabel}: {publicacion.merchantId}
          </span>
        )}
      </div>
      {detailHref === undefined || copy.detailLabel === undefined ? null : (
        <a className="tus-action-button tus-action-link tus-publicacion-detail-link" href={detailHref}>
          {copy.detailLabel}
        </a>
      )}
      {onCheckout === undefined ? null : (
        <TusActionButton
          disabled={checkoutLoading}
          loading={checkoutLoading}
          loadingLabel="Enviando…"
          onClick={onCheckout}
          type="button"
        >
          {copy.actionLabel}
        </TusActionButton>
      )}
      <small className="tus-boundary-note">{facts?.policy ?? copy.policy}</small>
    </article>
  )
}

const publicacionCardModule = { PublicacionCard }

export default publicacionCardModule
