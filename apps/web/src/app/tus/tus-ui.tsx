import { createElement, type ButtonHTMLAttributes, type ReactNode } from 'react'

import type { TusIntentAction, TusIntentFeedback } from '@/lib/tus-client'
import type { TusUiState, TusUiStatus } from '@/lib/tus-ui-contract'

interface TusStateMessageProps {
  state: Pick<TusUiState, 'status' | 'message' | 'code' | 'resource' | 'retry'>
  children?: ReactNode
}

interface TusFieldErrorProps {
  id: string
  message: string
}

interface TusSkipLinkProps {
  targetId?: string
}

interface TusActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean
  loadingLabel?: string
}

const STATE_PRESENTATION = {
  loading: { label: 'Loading', role: 'status', live: 'polite', busy: true },
  empty: { label: 'Nothing here yet', role: 'status', live: 'polite', busy: false },
  ready: { label: 'Current', role: 'status', live: 'polite', busy: false },
  pending: { label: 'Pending', role: 'status', live: 'polite', busy: false },
  conflict: { label: 'Review required', role: 'alert', live: 'assertive', busy: false },
  disabled: { label: 'Disabled', role: 'status', live: 'polite', busy: false },
  error: { label: 'Unable to load', role: 'alert', live: 'assertive', busy: false },
} as const

export function TusStateMessage({ state, children }: TusStateMessageProps): ReactNode {
  const presentation = STATE_PRESENTATION[state.status]
  const headingId =
    state.resource === undefined
      ? undefined
      : `tus-state-${state.resource.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`
  return createElement(
    'section',
    {
      'aria-atomic': 'true',
      'aria-label': headingId === undefined ? 'TUS status' : undefined,
      'aria-busy': presentation.busy,
      'aria-live': presentation.live,
      'aria-labelledby': headingId,
      className: 'tus-state-box',
      'data-status': state.status,
      role: presentation.role,
      tabIndex: presentation.role === 'alert' ? -1 : undefined,
    },
    state.resource === undefined ? null : createElement('h3', { id: headingId }, state.resource),
    createElement('strong', null, presentation.label),
    createElement('p', null, state.message),
    state.code === undefined ? null : createElement('small', null, `Reference: ${state.code}`),
    state.status === 'error' && state.retry === undefined
      ? null
      : state.status === 'error'
        ? createElement(
            TusActionButton,
            { onClick: state.retry, type: 'button' },
            `Retry ${state.resource ?? 'request'}`
          )
        : null,
    children
  )
}

export function TusSkipLink({ targetId = 'tus-main-content' }: TusSkipLinkProps): ReactNode {
  return createElement(
    'a',
    { className: 'tus-skip-link', href: `#${targetId}` },
    'Skip to main content'
  )
}

export function TusFieldError({ id, message }: TusFieldErrorProps): ReactNode {
  return createElement(
    'p',
    {
      'aria-atomic': 'true',
      'aria-live': 'assertive',
      className: 'tus-auth-error',
      id,
      role: 'alert',
    },
    message
  )
}

export function TusActionButton({
  children,
  loading = false,
  loadingLabel = 'Working…',
  disabled = false,
  ...props
}: TusActionButtonProps): ReactNode {
  return createElement(
    'button',
    {
      ...props,
      'aria-busy': loading,
      className: ['tus-action-button', props.className].filter(Boolean).join(' '),
      disabled: disabled || loading,
      type: props.type ?? 'button',
    },
    loading ? loadingLabel : children
  )
}

export function TusLiveRegion({
  children,
  status = 'polite',
}: {
  children: ReactNode
  status?: TusUiStatus | 'assertive' | 'polite'
}): ReactNode {
  const live =
    status === 'assertive' || status === 'polite' ? status : STATE_PRESENTATION[status].live
  return createElement(
    'p',
    { 'aria-atomic': 'true', 'aria-live': live, className: 'tus-visually-hidden' },
    children
  )
}

export function TusIntentFeedbackView({
  feedback,
  onAction,
}: {
  feedback: TusIntentFeedback
  onAction?: () => void
}): ReactNode {
  const isAlert = feedback.status === 'conflict' || feedback.status === 'error'
  const actionLabels: Record<TusIntentAction, string> = {
    retry: 'Retry same intent',
    refresh: 'Refresh server status',
    resolve: 'Review preserved intent',
    none: '',
  }
  const actionLabel = actionLabels[feedback.action]
  return createElement(
    'section',
    {
      'aria-atomic': 'true',
      'aria-live': isAlert ? 'assertive' : 'polite',
      className: `tus-intent-feedback tus-feedback-${feedback.status}`,
      'data-status': feedback.status,
      role: isAlert ? 'alert' : 'status',
    },
    createElement('strong', null, feedback.status),
    createElement('p', null, feedback.message),
    createElement('small', null, `${feedback.evidence} · Intent ${feedback.intentId}`),
    feedback.action === 'none' || onAction === undefined
      ? null
      : createElement(TusActionButton, { onClick: onAction, type: 'button' }, actionLabel)
  )
}

export default {
  TusActionButton,
  TusFieldError,
  TusIntentFeedbackView,
  TusLiveRegion,
  TusSkipLink,
  TusStateMessage,
}
