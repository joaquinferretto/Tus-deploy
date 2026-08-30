import { fireEvent, render, screen } from '@testing-library/react-native';

import { TusAccessibleButton } from '../../src/presentation/components/TusAccessibleButton';
import { TusLiveRegion } from '../../src/presentation/components/TusLiveRegion';
import { TusStateView } from '../../src/presentation/components/TusStateView';

describe('TUS mobile accessibility primitives', () => {
  it('announces pending state and exposes an actionable review control', () => {
    const onReview = jest.fn();

    render(
      <TusStateView
        actionLabel="Review operation"
        message="The operation is waiting for server acknowledgement."
        onAction={onReview}
        status="pending"
        title="Pending"
      />,
    );

    expect(screen.getByLabelText('Pending: The operation is waiting for server acknowledgement.')).toHaveProp('accessibilityLiveRegion', 'polite');
    expect(screen.getByText('The operation is waiting for server acknowledgement.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Review operation' }));
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('uses an assertive alert for conflicts without claiming completion', () => {
    render(
      <TusStateView
        message="Review the preserved operation before retrying."
        status="conflict"
        title="Review required"
      />,
    );

    expect(screen.getByLabelText('Review required: Review the preserved operation before retrying.')).toHaveProp('accessibilityLiveRegion', 'assertive');
    expect(screen.queryByText(/completed|successful/i)).toBeNull();
  });

  it('keeps a submitting action disabled and gives live feedback', () => {
    const onPress = jest.fn();

    render(
      <>
        <TusAccessibleButton
          disabled={false}
          loading
          onPress={onPress}
          label="Record operation"
        />
        <TusLiveRegion message="Waiting for TUS…" />
      </>,
    );

    const button = screen.getByRole('button', { name: 'Waiting for TUS…' });
    expect(button).toBeDisabled();
    expect(button).toHaveProp('accessibilityState', { disabled: true, busy: true });
    const liveRegion = screen.getAllByText('Waiting for TUS…').find((element) => element.props.accessibilityLiveRegion === 'polite');
    expect(liveRegion).toHaveProp('accessibilityLiveRegion', 'polite');
    expect(onPress).not.toHaveBeenCalled();
  });

  it('offers separate retry and local discard actions for a preserved conflict', () => {
    const onRetry = jest.fn();
    const onDiscard = jest.fn();

    render(
      <TusStateView
        actionLabel="Retry preserved operation"
        secondaryActionLabel="Discard preserved conflict"
        message="The operation is preserved for review; no success is claimed."
        onAction={onRetry}
        onSecondaryAction={onDiscard}
        status="conflict"
        title="Review required"
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Retry preserved operation' }));
    fireEvent.press(screen.getByRole('button', { name: 'Discard preserved conflict' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
