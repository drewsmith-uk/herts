export interface DeviceNotificationInput<T = unknown> {
  key: string;
  title: string;
  body?: string;
  route: string;
  restoreOnDismiss: boolean;
  metadata: T;
}

export interface DeviceNotification<T = unknown> extends DeviceNotificationInput<T> {
  revision: string;
  createdAt: number;
  displayError?: string;
}

export function deviceNotificationRoute(value: unknown): value is string {
  return typeof value === 'string' && /^\/[a-z][a-z0-9-]*(?:\/[^?#\\\s]*)?$/.test(value)
    && value.length <= 8192 && !/[\u0000-\u001f\u007f]/.test(value);
}
