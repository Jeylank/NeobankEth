import { Platform, Alert as RNAlert } from 'react-native';

export interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

/**
 * Cross-platform alert helper.
 *
 * react-native-web's `Alert.alert` is a no-op (does not render any UI),
 * so on web every confirm dialog built with RN's `Alert.alert` silently
 * does nothing — buttons like "Sign Out" appear unresponsive.
 * This wrapper falls back to `window.confirm`/`window.alert` on web.
 */
export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS !== 'web') {
    RNAlert.alert(title, message, buttons);
    return;
  }

  const text = [title, message].filter(Boolean).join('\n\n');

  if (!buttons || buttons.length === 0) {
    window.alert(text);
    return;
  }

  const cancelButton = buttons.find((b) => b.style === 'cancel');
  const confirmButton = buttons.find((b) => b.style !== 'cancel') ?? buttons[0];

  if (buttons.length === 1) {
    window.alert(text);
    confirmButton.onPress?.();
    return;
  }

  const confirmed = window.confirm(text);
  if (confirmed) {
    confirmButton.onPress?.();
  } else {
    cancelButton?.onPress?.();
  }
}
