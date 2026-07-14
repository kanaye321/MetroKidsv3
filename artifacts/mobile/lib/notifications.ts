/**
 * lib/notifications — local push-style notifications for new chat messages.
 *
 * Uses expo-notifications to post a banner in the phone's notification bar when a
 * message arrives while the app is backgrounded or the user isn't looking at Chat.
 * No remote push server is involved — these are locally-scheduled notifications
 * fired immediately (trigger: null) from the socket event handler.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

const CHANNEL_ID = 'chat-messages';
let handlerConfigured = false;

/** Sets up the foreground presentation behavior + Android notification channel. Idempotent. */
export function configureNotifications() {
  if (handlerConfigured || Platform.OS === 'web') return;
  handlerConfigured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Chat messages',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 150, 100, 150],
    }).catch(() => {});
  }
}

/** Shows the OS permission prompt (a no-op if already granted or already denied). */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    configureNotifications();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (current.canAskAgain === false) return false;
    const result = await Notifications.requestPermissionsAsync();
    return result.granted;
  } catch {
    return false;
  }
}

/** Posts a local notification into the system notification tray/banner. */
export async function notifyNewMessage(title: string, body: string) {
  if (Platform.OS === 'web') return;
  try {
    const perms = await Notifications.getPermissionsAsync();
    if (!perms.granted) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
      trigger: null,
    });
  } catch {}
}
