import { Text, type TextProps } from 'react-native';

export interface TusLiveRegionProps extends TextProps {
  message: string;
  emphasis?: 'polite' | 'assertive';
}

export function TusLiveRegion({ message, emphasis = 'polite', ...props }: TusLiveRegionProps) {
  return (
    <Text
      {...props}
      accessibilityLiveRegion={emphasis}
      accessibilityLabel={message}
      accessibilityRole={emphasis === 'assertive' ? 'alert' : undefined}
    >
      {message}
    </Text>
  );
}
