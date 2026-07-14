# MetroEast RideLink — EAS Build Guide

Everything you need to go from this repo to App Store and Play Store builds.

---

## Prerequisites

| Tool | Install |
|------|---------|
| Node 22 | `nvm install 22` |
| pnpm | `npm i -g pnpm` |
| EAS CLI | `npm i -g eas-cli` |
| Expo account | https://expo.dev/signup |
| Apple Developer account | https://developer.apple.com (iOS only) |
| Google Play Console account | https://play.google.com/console (Android only) |

---

## 1 — One-time project setup

### 1a. Log in and link EAS

```bash
cd artifacts/mobile
eas login          # sign in to your Expo account
eas init           # links this project; writes projectId into eas.json
```

After `eas init`, open `app.config.ts` and confirm `extra.eas.projectId` is populated (EAS CLI writes it automatically to `app.json` — you may need to copy it to the `extra.eas` block in `app.config.ts`).

### 1b. Set EAS build secrets

These two values are baked into the JS bundle at build time, so they **must** be set before every build.

```bash
# The Google Maps / Directions / Places API key
eas secret:create --scope project --name EXPO_PUBLIC_GOOGLE_MAPS_KEY --value "YOUR_KEY_HERE"

# The hostname of your deployed API server (no protocol, no trailing slash)
# Example: my-repl-username.replit.app
eas secret:create --scope project --name EXPO_PUBLIC_DOMAIN --value "YOUR_API_HOSTNAME"
```

> **Google Cloud Console** — make sure these APIs are enabled for your key:
> - Maps SDK for Android
> - Maps SDK for iOS
> - Directions API
> - Places API
> - Geocoding API

---

## 2 — Build profiles

| Profile | What it produces | When to use |
|---------|------------------|-------------|
| `development` | Internal `.apk` / dev-client `.ipa` | Local testing on a real device |
| `preview` | Internal `.apk` / ad-hoc `.ipa` | QA / beta testers (no store) |
| `production` | `.aab` (Play Store) / `.ipa` (App Store) | Store submission |

---

## 3 — Android builds

### 3a. Preview APK (fastest, no signing setup needed)

```bash
eas build --platform android --profile preview
```

Install the resulting APK directly on Android devices or share via the EAS link.

### 3b. Production AAB (Play Store)

```bash
eas build --platform android --profile production
```

EAS automatically creates and manages the **Android keystore** the first time you run a production build. Keep a copy of it — losing it means you can never update the app on Play Store.

To download your keystore backup:
```bash
eas credentials --platform android
```

### 3c. Submit to Play Store

1. Create a service-account JSON key in Google Play Console → Setup → API access.
2. Save it as `artifacts/mobile/google-play-service-account.json` (git-ignored).
3. Update `eas.json` → `submit.production.android.serviceAccountKeyPath`.

```bash
eas submit --platform android --latest
```

---

## 4 — iOS builds

### 4a. Signing setup

EAS manages certificates and provisioning profiles for you:

```bash
eas credentials --platform ios
```

Choose **"Expo-managed"** credentials and follow the prompts. You'll need your Apple Developer account credentials.

### 4b. Preview build (ad-hoc, for testers)

```bash
eas build --platform ios --profile preview
```

Register test devices via `eas device:create` before building so their UDIDs are included in the provisioning profile.

### 4c. Production build (App Store)

```bash
eas build --platform ios --profile production
```

### 4d. Submit to App Store Connect

1. In `eas.json` → `submit.production.ios`, fill in:
   - `appleTeamId` — your 10-character team ID (Apple Developer portal → Membership)
   - `ascAppId` — your App Store Connect app ID (create the app record first at https://appstoreconnect.apple.com)

```bash
eas submit --platform ios --latest
```

---

## 5 — Build both platforms at once

```bash
eas build --platform all --profile production
```

---

## 6 — App icons and splash screen

The current build uses a single `assets/images/icon.png`.  
For a polished store listing, supply:

| File | Size | Purpose |
|------|------|---------|
| `assets/images/icon.png` | 1024×1024 px, no transparency | iOS icon + base |
| `assets/images/adaptive-icon.png` | 1024×1024 px, safe-zone centred | Android adaptive icon foreground |
| `assets/images/splash.png` | 1284×2778 px | Splash screen |

Update `app.config.ts` to point each field to its dedicated file once you have them.

---

## 7 — Push notifications (optional)

`expo-notifications` is included but requires Firebase for Android:

1. Create a Firebase project at https://console.firebase.google.com
2. Add an Android app with package `com.metroeast.ridelink`
3. Download `google-services.json` and place it at `artifacts/mobile/google-services.json`
4. Add the plugin to `app.config.ts`:
   ```ts
   ['@react-native-firebase/app', {}],
   ```
5. Run `eas build` — EAS picks up the file automatically.

For iOS push notifications, upload your APNs key via `eas credentials --platform ios`.

---

## 8 — Over-the-air updates (OTA)

After the initial store build you can push JS-only fixes instantly without going through review:

```bash
eas update --branch production --message "Fix route snapping threshold"
```

Configure which builds receive which OTA channel in `eas.json` by adding `channel: "production"` to the production build profile.

---

## 9 — Checklist before first submission

- [ ] `bundleIdentifier` / `package` are unique (check App Store Connect + Play Console)
- [ ] `EXPO_PUBLIC_GOOGLE_MAPS_KEY` EAS secret is set
- [ ] `EXPO_PUBLIC_DOMAIN` EAS secret points to your live API server
- [ ] Google Cloud APIs enabled: Maps SDK (iOS + Android), Directions, Places, Geocoding
- [ ] App icon is 1024×1024 with no transparency (iOS rejects transparent icons)
- [ ] Privacy policy URL ready (both stores require it for location + microphone access)
- [ ] `eas init` run and `projectId` confirmed in `app.config.ts`
- [ ] Android keystore backup downloaded
- [ ] iOS credentials configured via `eas credentials`
- [ ] App Store Connect app record created with correct bundle ID
- [ ] Google Play app created with correct package name
