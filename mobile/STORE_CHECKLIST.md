# NexRep — App Store & Play Store checklist

## Icons

| Platform | Size | File |
|----------|------|------|
| iOS App Store | 1024×1024 PNG (no alpha) | `assets/icon.png` |
| Android Play | 512×512 PNG | `assets/icon.png` |
| Android adaptive | 1024×1024 foreground | `assets/adaptive-icon.png` |

## Screenshots (verify current store requirements)

### iOS (App Store Connect)
- iPhone 6.7": 1290×2796
- iPhone 6.5": 1284×2778
- iPad Pro 12.9": 2048×2732 (if supporting iPad)

### Android (Play Console)
- Phone: min 2 screenshots, 1080×1920 or higher (16:9 or 9:16)
- 7" / 10" tablet optional

## Data safety (Google Play) / Privacy (Apple)

Declare collection/use of:
- **Health & fitness** data (workouts, calories, weight)
- **Email** (account)
- **Camera** (food scanning)
- Optional: analytics if added later

## Privacy policy

- Host a public privacy policy URL before submission.
- Placeholder: `https://yourapp.com/privacy`

## Content rating

- Complete Google Play content rating questionnaire.
- Complete Apple age rating in App Store Connect.

## Build commands

```bash
npm run build:android
npm run build:ios
npm run submit:android
npm run submit:ios
```
