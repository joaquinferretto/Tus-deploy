import { Pressable, StyleSheet, Text, type PressableProps, type StyleProp, type TextStyle } from 'react-native';

export interface TusAccessibleButtonProps extends Omit<PressableProps, 'accessibilityLabel' | 'children'> {
  label: string;
  loading?: boolean;
  loadingLabel?: string;
  labelStyle?: StyleProp<TextStyle>;
}

export function TusAccessibleButton({ label, loading = false, loadingLabel = 'Waiting for TUS…', disabled = false, onPress, style, labelStyle, ...props }: TusAccessibleButtonProps) {
  const isDisabled = disabled || loading;
  const visibleLabel = loading ? loadingLabel : label;

  return (
    <Pressable
      {...props}
      accessibilityLabel={visibleLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={(state) => [styles.button, state.pressed && styles.pressed, isDisabled && styles.disabled, typeof style === 'function' ? style(state) : style]}
    >
      <Text style={[styles.label, labelStyle]}>{visibleLabel}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 18,
  },
  label: {
    fontSize: 15,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
});
