export const TUS_MOBILE_LAYOUT = {
  minimumTouchTarget: 44,
  contentPadding: 20,
  contentBottomPadding: 48,
} as const;

export const MOBILE_SAFE_AREA_EDGES = ['top', 'right', 'bottom', 'left'] as const;

const TUS_CONNECTIVITY_STATUS = {
  CONNECTED: 'connected',
  OFFLINE: 'offline',
  PENDING: 'pending',
  RECONNECTING: 'reconnecting',
} as const;

export type TusConnectivityStatus = (typeof TUS_CONNECTIVITY_STATUS)[keyof typeof TUS_CONNECTIVITY_STATUS];

export interface TusConnectivityInput {
  isOnline: boolean;
  pendingCount: number;
  isReconnecting?: boolean;
}

export interface TusConnectivityPresentation {
  status: TusConnectivityStatus;
  label: string;
  message: string;
}

export function resolveTusConnectivityPresentation({
  isOnline,
  pendingCount,
  isReconnecting = false,
}: TusConnectivityInput): TusConnectivityPresentation {
  if (isReconnecting) {
    return {
      status: TUS_CONNECTIVITY_STATUS.RECONNECTING,
      label: 'Reconnecting…',
      message: 'TUS connectivity is being restored. New operations remain pending until confirmed.',
    };
  }

  if (!isOnline) {
    return {
      status: TUS_CONNECTIVITY_STATUS.OFFLINE,
      label: 'Offline',
      message: 'Pending work stays in the encrypted local queue until TUS is reachable.',
    };
  }

  if (pendingCount > 0) {
    return {
      status: TUS_CONNECTIVITY_STATUS.PENDING,
      label: 'Connected · pending sync',
      message: 'TUS is reachable. Review the pending queue before syncing.',
    };
  }

  return {
    status: TUS_CONNECTIVITY_STATUS.CONNECTED,
    label: 'Connected',
    message: 'TUS is reachable for new operations.',
  };
}
