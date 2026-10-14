# Pinned notifications

Pinned is an optional Herts plugin.
It keeps conversation and task titles in notifications on this device.
Pins do not synchronise between devices.

## Enable Pinned

1. Update the Browser App through **Settings → App updates**.
2. Open **Settings → Plugins**.
3. Select **Rescan plugins**.
4. Enable **Pinned**.

Use **Tab order** to change the position of Pinned.
The package uses the route `/plugins/pinned`.

## Pin a title

1. Open a conversation or task.
2. Select the pin button, labelled **Pin notification**.
3. Allow notification permission if the browser requests it.

Herts saves the pin on this device.
If notification display fails, the saved pin remains available in Pinned.
Select **Retry** after you correct the notification permission or display problem.

Select a notification to open its conversation or task.
This does not remove the pin.
Saved title changes update the notification when Herts receives them.
Task completion, hiding, and snoozing do not remove pins.

## Remove or pause pins

Select **Unpin** in Pinned, or select **Unpin notification** in the conversation header.
Herts removes the saved pin before it closes the notification.
You can unpin while offline.

Disabling the plugin closes its notifications and stops restoration.
Herts retains the saved pins.
Re-enabling the plugin restores them.
**Reset data** deletes this plugin's pins from each device when that device receives the reset.
Offline devices receive plugin lifecycle changes when they reconnect.
Conversation messages and drafts remain available.

The push notification controls affect server reminders and work updates.
Pinned uses device notifications without a push subscription.

## Browser limits

Chrome on Android is the target browser.
Its [notification dismissal event](https://developer.chrome.com/blog/notifications) lets Herts request restoration after dismissal.
Herts restores pinned notifications silently, without another sound or vibration.
The pin remains saved if the browser cannot display it.

Browser restrictions, device restrictions, revoked permissions, and stopping Chrome can prevent restoration.
Reopen Herts to restore missing notifications.
Clearing browser storage removes local pins.
Other browsers can support different notification behaviour.

## Development checks

Use isolated synthetic notifications for validation.
Do not use live bots or model prompts.
Check dismissal and **Clear all** on an actual Android device.
Also check offline operation, app closure, device restart, unpinning, and plugin disable or reset.
Record the browser version, Android version, and observed results.
Automated worker events do not verify the Android notification tray.
