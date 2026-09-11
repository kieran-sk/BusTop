/**
 * Service Worker για τις Αστικές Συγκοινωνίες Αθηνών (ΟΑΣΑ)
 * Background alarm notification scheduler and offline caching
 */

const CACHE_NAME = 'oasa-bus-v23';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/m3-expressive.css',
  '/css/airport-ticker.css',
  '/js/api.js',
  '/js/map-manager.js',
  '/js/ticker.js',
  '/js/alarms.js',
  '/js/pinned-trips.js',
  '/js/timetable.js',
  '/js/search.js',
  '/js/favorites.js',
  '/js/app.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Purging obsolete cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

function formatMinutesHuman(mins) {
  if (typeof mins !== 'number' || isNaN(mins)) return '--';
  if (mins < 60) return `${mins}λ`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}ω ${remMins}λ` : `${hours}ω`;
}

// Active Alarms Map for background countdown
const activeAlarms = new Map();
let alarmTickerInterval = null;

function tickServiceWorkerAlarms() {
  const now = Date.now();
  for (const [id, alarm] of activeAlarms.entries()) {
    const elapsedMins = Math.floor((now - alarm.createdAt) / 60000);
    const remainingMins = Math.max(0, alarm.initialMinutes - elapsedMins);

    if (remainingMins <= alarm.thresholdMinutes) {
      // Threshold reached: Ring the loud alert!
      const destText = alarm.destination ? `\n🏁 Προορισμός: ${alarm.destination}` : '';
      const remFormatted = formatMinutesHuman(remainingMins);
      self.registration.showNotification(`🚨 Το Λεωφορείο ${alarm.lineId} πλησιάζει!`, {
        body: `Η γραμμή ${alarm.lineId} απέχει ${remFormatted} από τη στάση ${alarm.stopName}.${destText}\nΏρα για αναχώρηση!`,
        tag: `bus_alarm_${alarm.id}`,
        icon: '/assets/icon-192.png',
        badge: '/assets/icon-192.png',
        vibrate: [800, 200, 800, 200, 800, 200, 1200],
        renotify: true,
        requireInteraction: true,
        silent: false,
        data: { url: '/?tab=ticker' }
      });

      // Clear the silent ongoing countdown notification
      self.registration.getNotifications({ tag: `live_alarm_${alarm.id}` }).then((notifs) => {
        notifs.forEach(n => n.close());
      });

      activeAlarms.delete(id);
    } else {
      // Live countdown notification update
      const destLine = alarm.destination ? ` • Προς ${alarm.destination}` : '';
      const walkLine = alarm.walkMinutes ? `\n🚶 Βάδισμα: ~${formatMinutesHuman(alarm.walkMinutes)}` : '';
      const timeDisplay = formatMinutesHuman(remainingMins);
      self.registration.showNotification(`🚍 ${alarm.lineId} σε ${timeDisplay}`, {
        body: `Στάση: ${alarm.stopName}${destLine}${walkLine} • Ειδοποίηση στα ${formatMinutesHuman(alarm.thresholdMinutes)}`,
        tag: `live_alarm_${alarm.id}`,
        icon: '/assets/icon-192.png',
        badge: '/assets/icon-192.png',
        silent: true,
        renotify: false,
        data: { url: '/?tab=ticker' }
      });
    }
  }

  if (activeAlarms.size === 0 && alarmTickerInterval) {
    clearInterval(alarmTickerInterval);
    alarmTickerInterval = null;
  }
}

// Background alarm listener & Android Live Updates
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SCHEDULE_ALARM') {
    const { id, lineId, stopName, initialMinutes, thresholdMinutes, createdAt } = event.data;
    activeAlarms.set(id, {
      id,
      lineId,
      stopName,
      initialMinutes: initialMinutes || 10,
      thresholdMinutes: thresholdMinutes || 5,
      createdAt: createdAt || Date.now()
    });

    if (!alarmTickerInterval) {
      alarmTickerInterval = setInterval(tickServiceWorkerAlarms, 30000);
    }

    // Show initial live notification immediately
    self.registration.showNotification(`🚍 ${lineId} σε ${initialMinutes || 10}λ`, {
      body: `Στάση: ${stopName} • Ειδοποίηση στα ${thresholdMinutes || 5}λ`,
      tag: `live_alarm_${id}`,
      icon: '/assets/icon-192.png',
      badge: '/assets/icon-192.png',
      silent: true,
      renotify: false,
      data: { url: '/?tab=ticker' }
    });
  }

  if (event.data.type === 'CANCEL_ALARM') {
    const { id } = event.data;
    activeAlarms.delete(id);
    self.registration.getNotifications({ tag: `live_alarm_${id}` }).then((notifications) => {
      notifications.forEach(n => n.close());
    });
    if (activeAlarms.size === 0 && alarmTickerInterval) {
      clearInterval(alarmTickerInterval);
      alarmTickerInterval = null;
    }
  }

  // Android Live Ongoing Notification for pinned trips
  if (event.data.type === 'UPDATE_PINNED_LIVE_NOTIFICATION') {
    const { title, body, tag, badgeCount } = event.data;
    if (self.Notification && self.Notification.permission === 'granted') {
      self.registration.showNotification(title || 'Ενημέρωση Άφιξης', {
        body: body || '',
        tag: tag || 'live-pinned-bus-tracker',
        icon: '/assets/icon-192.png',
        badge: '/assets/icon-192.png',
        silent: true,
        renotify: false,
        data: { url: '/?tab=pinned' }
      });
    }
    if ('setAppBadge' in self.navigator && typeof badgeCount === 'number') {
      self.navigator.setAppBadge(badgeCount).catch(() => {});
    }
  }

  if (event.data.type === 'CLEAR_PINNED_LIVE_NOTIFICATION') {
    self.registration.getNotifications({ tag: 'live-pinned-bus-tracker' }).then((notifications) => {
      notifications.forEach(n => n.close());
    });
    if ('clearAppBadge' in self.navigator) {
      self.navigator.clearAppBadge().catch(() => {});
    }
  }
});

// Web Push Notification Handler (iOS PWA & Desktop Web Push)
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { body: event.data.text() };
    }
  }

  const title = data.title || '🚨 Το Λεωφορείο πλησιάζει!';
  const options = {
    body: data.body || 'Το λεωφορείο πλησιάζει στη στάση σας. Ώρα για αναχώρηση!',
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    vibrate: [800, 200, 800, 200, 800],
    renotify: true,
    requireInteraction: true,
    tag: data.tag || ('bus_push_' + Date.now()),
    data: { url: data.url || '/?tab=notifications' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'cancel') {
    const tag = event.notification.tag || '';
    if (tag.startsWith('live_alarm_')) {
      const alarmId = tag.replace('live_alarm_', '');
      activeAlarms.delete(alarmId);
    }
    return;
  }

  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client && targetUrl) {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  if (event.request.url.includes('/api/')) {
    // Network-first with Cache-fallback for offline route and direction support
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open('oasa-api-cache').then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Network-First for HTML, JS, CSS and all static assets
  // Guarantees immediate updates on fresh deploy, with offline fallback
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
