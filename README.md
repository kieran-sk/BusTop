# Athens OASA Bus - Live Tracking & Commuter Suite 🚌🇬🇷

A transit tracking web application and Android app for Athens, Greece, powered by the official **OASA Telematics API**, designed with **Material 3 Expressive**, and integrated with **Google Maps Platform**.

---

## Features

- 🛫 **Airport Flight Board ("Ticker")**: Mechanical split-flap departure board displaying live countdowns, route destinations, and real-time walking navigation estimates from your current GPS location (with commute advice: *Relax*, *Leave Now*, *Hurry*, or *Take Next*).
- 🟢 **Live Bus Tracking & Estimated Arrivals**: Real-time arrival predictions via OASA Telematics GPS beacons + timetable-based arrival estimation engine for pre-departure or non-telematics buses.
- 🗺️ **Google Maps Platform Integration**: Interactive map with `AdvancedMarkerElement`, custom bus badges, stop pins, and polyline route paths (`internalUsageAttributionIds: ['gmp_git_agentskills_v1']`).
- 📅 **Full Timetables per Line**: View schedules for all 470+ Athens bus lines across service days (Weekdays, Saturdays, Sundays/Holidays) and directions (Outbound/Inbound).
- 🔔 **Custom Proximity Alarms**: Set threshold alarms (e.g. 5 min before bus arrives) with Web Audio synthesized chimes, system push notifications, and device vibration.
- 🔍 **Instant Search & "Near Me" GPS Radar**: Search by line ID (e.g. 040, X95, 608) or stop code, plus instant GPS scanning for nearby stops.
- ⭐ **Favorites**: Bookmark favorite lines and stops for one-tap access.
- 📱 **Android & PWA Ready**: Installable as a Progressive Web App (PWA) and includes a complete Android Studio project with native bridge and background `AlarmManager`.

---

## Project Structure

```
oasa-athens-bus/
├── server/
│   ├── server.js               # Node.js Express server & API proxy
│   ├── oasa-service.js         # OASA Telematics API client with smart caching
│   └── arrival-estimator.js    # Pre-departure & timetable arrival estimator
├── web/
│   ├── index.html              # Material 3 Expressive single-page app
│   ├── manifest.json           # PWA Web App Manifest
│   ├── sw.js                   # Offline caching Service Worker
│   ├── css/
│   │   ├── m3-expressive.css   # Material 3 Expressive design tokens & components
│   │   └── airport-ticker.css  # Split-flap & LED departure board styles
│   └── js/
│       ├── api.js              # Client API wrapper
│       ├── google-map.js       # Google Maps Platform manager
│       ├── ticker.js           # Airport flight board & walk navigation engine
│       ├── alarms.js           # Proximity alarms (Web Audio & Notifications)
│       ├── timetable.js        # Timetable viewer
│       ├── search.js           # Instant search & GPS radar
│       ├── favorites.js        # Starred stops & lines manager
│       └── app.js              # Main application controller
└── android/
    ├── settings.gradle.kts
    ├── build.gradle.kts
    └── app/
        ├── build.gradle.kts    # Material 3 & Google Maps SDK dependencies
        └── src/main/
            ├── AndroidManifest.xml
            └── java/com/oasa/athensbus/
                ├── MainActivity.kt       # Activity with native bridge & Maps setup
                ├── NotificationHelper.kt # High-priority notification channels
                └── AlarmReceiver.kt      # BroadcastReceiver for background bus alarms
```

---

## Quick Start (Web & Server)

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Google Maps (Optional)**:
   - Edit `.env` to set your Google Cloud Maps API Key:
     ```env
     GOOGLE_MAPS_API_KEY=your_key_here
     ```
   - *Note: You can also use the free [Maps Demo Key](https://mapsplatform.google.com/maps-demo-key?utm_campaign=gmp_git_agentskills_v1) or enter it directly in the web UI!*

3. **Start the Server**:
   ```bash
   npm start
   ```
   Open your browser at [http://localhost:3000](http://localhost:3000).

---

## Android Project Setup

1. Open **Android Studio**.
2. Select **Open** and choose the `android/` directory inside this project:
   `C:\Users\steph\.gemini\antigravity\scratch\oasa-athens-bus\android`
3. In `android/app/src/main/res/values/strings.xml`, enter your Google Maps Android API Key.
4. Build and run on an Android Device or Emulator!
