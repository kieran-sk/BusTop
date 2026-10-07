package com.oasa.athensbus

import android.app.ForegroundServiceStartNotAllowedException
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.graphics.drawable.Icon
import androidx.core.app.NotificationCompat
import android.os.PowerManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

class LiveTrackingService : Service() {

    private val serviceJob = Job()
    private val serviceScope = CoroutineScope(Dispatchers.IO + serviceJob)
    private var pollingJob: Job? = null

    private var stopCode: String = ""
    private var lineId: String = ""
    private var routeCode: String = ""
    private var stopName: String = ""
    private var destination: String = ""
    private var walkMinutes: Int = 0
    private var thresholdMinutes: Int = 0
    private var initialMinutes: Int = 10
    private var startedAtMs: Long = 0L
    private var ringUntilDismissed: Boolean = false
    private var isAlarmTriggered = false
    private var wakeLock: PowerManager.WakeLock? = null

    companion object {
        const val ACTION_START = "ACTION_START_LIVE_TRACKING"
        const val ACTION_STOP = "ACTION_STOP_LIVE_TRACKING"
        const val ACTION_STOP_SERVICE_ONLY = "ACTION_STOP_LIVE_TRACKING_SERVICE_ONLY"

        const val EXTRA_STOP_CODE = "EXTRA_STOP_CODE"
        const val EXTRA_LINE_ID = "EXTRA_LINE_ID"
        const val EXTRA_ROUTE_CODE = "EXTRA_ROUTE_CODE"
        const val EXTRA_STOP_NAME = "EXTRA_STOP_NAME"
        const val EXTRA_DESTINATION = "EXTRA_DESTINATION"
        const val EXTRA_WALK_MINUTES = "EXTRA_WALK_MINUTES"
        const val EXTRA_THRESHOLD = "EXTRA_THRESHOLD"
        const val EXTRA_INITIAL_MINS = "EXTRA_INITIAL_MINS"
        const val EXTRA_RING_UNTIL_DISMISSED = "EXTRA_RING_UNTIL_DISMISSED"

        fun start(
            context: Context,
            stopCode: String,
            lineId: String,
            routeCode: String,
            stopName: String,
            destination: String,
            walkMinutes: Int,
            threshold: Int,
            ringUntilDismissed: Boolean = false,
            initialMinutes: Int = 10
        ) {
            val intent = Intent(context, LiveTrackingService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_STOP_CODE, stopCode)
                putExtra(EXTRA_LINE_ID, lineId)
                putExtra(EXTRA_ROUTE_CODE, routeCode)
                putExtra(EXTRA_STOP_NAME, stopName)
                putExtra(EXTRA_DESTINATION, destination)
                putExtra(EXTRA_WALK_MINUTES, walkMinutes)
                putExtra(EXTRA_THRESHOLD, threshold)
                putExtra(EXTRA_RING_UNTIL_DISMISSED, ringUntilDismissed)
                putExtra(EXTRA_INITIAL_MINS, initialMinutes)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    try {
                        context.startForegroundService(intent)
                    } catch (e: ForegroundServiceStartNotAllowedException) {
                        context.startService(intent)
                    }
                } else {
                    context.startForegroundService(intent)
                }
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, LiveTrackingService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            val stopToUnpin = intent.getStringExtra(EXTRA_STOP_CODE) ?: stopCode
            val lineToUnpin = intent.getStringExtra(EXTRA_LINE_ID) ?: lineId
            if (stopToUnpin.isNotBlank() && lineToUnpin.isNotBlank()) {
                MainActivity.currentInstance?.unpinAndDismiss(stopToUnpin, lineToUnpin)
            } else {
                MainActivity.currentInstance?.unpinAllAndDismiss()
            }
            pollingJob?.cancel()
            pollingJob = null
            releaseWakeLock()
            try {
                val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                manager.cancel(NotificationHelper.LIVE_NOTIF_ID)
            } catch (_: Exception) {}
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        if (intent?.action == ACTION_STOP_SERVICE_ONLY) {
            pollingJob?.cancel()
            pollingJob = null
            releaseWakeLock()
            try {
                val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                manager.cancel(NotificationHelper.LIVE_NOTIF_ID)
            } catch (_: Exception) {}
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        acquireWakeLock()

        val newStop = intent?.getStringExtra(EXTRA_STOP_CODE) ?: ""
        val newLine = intent?.getStringExtra(EXTRA_LINE_ID) ?: ""
        val newThreshold = intent?.getIntExtra(EXTRA_THRESHOLD, 0) ?: 0
        val isSameTrip = (newStop.isNotBlank() && newStop == stopCode && newLine.equals(lineId, ignoreCase = true))

        stopCode = newStop
        lineId = newLine
        routeCode = intent?.getStringExtra(EXTRA_ROUTE_CODE) ?: ""
        stopName = intent?.getStringExtra(EXTRA_STOP_NAME) ?: "Στάση ΟΑΣΑ"
        destination = intent?.getStringExtra(EXTRA_DESTINATION) ?: ""
        walkMinutes = intent?.getIntExtra(EXTRA_WALK_MINUTES, 0) ?: 0
        thresholdMinutes = newThreshold
        val newRing = intent?.getBooleanExtra(EXTRA_RING_UNTIL_DISMISSED, false) ?: false
        ringUntilDismissed = newRing
        val newInitMins = intent?.getIntExtra(EXTRA_INITIAL_MINS, 10) ?: 10

        if (newThreshold <= 0) {
            // Strictly passive pinned trip tracking: 100% silent, alarm triggers permanently disabled
            thresholdMinutes = 0
            ringUntilDismissed = false
            isAlarmTriggered = true
            AlarmRingingService.dismiss(this)
        }

        if (!isSameTrip) {
            initialMinutes = newInitMins
            startedAtMs = System.currentTimeMillis()
            if (newThreshold > 0) {
                isAlarmTriggered = false
            }
            // Cancel previous polling loop so newly pinned line begins polling immediately
            pollingJob?.cancel()
            pollingJob = null
        }

        NotificationHelper.createLiveNotificationChannel(this)
        val initialNotif = buildLiveNotification(initialMinutes)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NotificationHelper.LIVE_NOTIF_ID, initialNotif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NotificationHelper.LIVE_NOTIF_ID, initialNotif)
        }

        startBackgroundPolling()

        return START_STICKY
    }

    private fun acquireWakeLock() {
        try {
            if (wakeLock == null) {
                val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BusTop:LiveTrackingWakeLock")
                wakeLock?.acquire(60 * 60 * 1000L) // 1 hour max
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
            wakeLock = null
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun startBackgroundPolling() {
        if (pollingJob?.isActive == true) return
        pollingJob = serviceScope.launch {
            while (isActive) {
                var remainingMins = initialMinutes
                try {
                    // Try fetching live GPS telemetry from API
                    val liveMins = fetchLiveArrivalMinutes()

                    if (liveMins != null) {
                        remainingMins = liveMins
                    } else {
                        // Fallback to elapsed time if GPS is temporarily absent or network drops
                        val elapsedMins = ((System.currentTimeMillis() - startedAtMs) / 60000L).toInt()
                        remainingMins = kotlin.math.max(0, initialMinutes - elapsedMins)
                    }

                    updateNotification(remainingMins)

                    if (thresholdMinutes > 0 && remainingMins <= thresholdMinutes && !isAlarmTriggered) {
                        isAlarmTriggered = true
                        triggerAlarmWakeup(remainingMins)
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }

                // High-frequency responsive polling for real-time live notification shade & status chip validation
                val pollDelayMs = when {
                    remainingMins > 15 -> 15000L  // Far (>15m away): 15s
                    remainingMins > 5  -> 10000L  // Approaching (5-15m away): 10s
                    else               -> 6000L   // Arriving now (<=5m away): 6s for maximum real-time precision
                }
                delay(pollDelayMs)
            }
        }
    }

    private fun fetchLiveArrivalMinutes(): Int? {
        if (stopCode.isBlank()) return null
        return try {
            val url = URL("https://bustop.pages.dev/api/stops/$stopCode/arrivals")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 7000
            conn.readTimeout = 7000
            conn.setRequestProperty("Accept", "application/json")

            if (conn.responseCode == 200) {
                val reader = BufferedReader(InputStreamReader(conn.inputStream))
                val response = reader.readText()
                reader.close()

                val json = JSONObject(response)
                val arrivals = json.optJSONArray("arrivals")
                if (arrivals != null) {
                    var bestLiveMins: Int? = null
                    var bestSchedMins: Int? = null

                    for (i in 0 until arrivals.length()) {
                        val arr = arrivals.getJSONObject(i)
                        val arrLine = arr.optString("line_id", "")
                        val arrRoute = arr.optString("route_code", "")

                        if (arrLine.equals(lineId, ignoreCase = true) &&
                            (routeCode.isBlank() || arrRoute.isBlank() || arrRoute == routeCode)) {
                            val btime2 = arr.optInt("btime2", -1)
                            val isLive = arr.optBoolean("is_live", false)
                            if (btime2 >= 0) {
                                if (isLive) {
                                    // Live GPS arrivals take absolute priority
                                    if (bestLiveMins == null || btime2 < bestLiveMins) {
                                        bestLiveMins = btime2
                                        val apiDest = arr.optString("destination", "").ifBlank {
                                            arr.optString("route_descr", "")
                                        }
                                        if (apiDest.isNotBlank()) {
                                            val cleaned = NotificationHelper.cleanDestination(apiDest)
                                            if (cleaned.isNotBlank()) destination = cleaned
                                        }
                                    }
                                } else {
                                    // Fallback scheduled timetable estimate
                                    if (bestSchedMins == null || btime2 < bestSchedMins) {
                                        bestSchedMins = btime2
                                    }
                                }
                            }
                        }
                    }

                    val resultMins = bestLiveMins ?: bestSchedMins
                    if (resultMins != null) {
                        // Dynamically update rolling reference so subsequent minutes decay gracefully from actual telematics
                        initialMinutes = resultMins
                        startedAtMs = System.currentTimeMillis()
                        return resultMins
                    }
                }
            }
            null
        } catch (e: Exception) {
            null
        }
    }

    private fun updateNotification(mins: Int) {
        val notif = buildLiveNotification(mins)
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NotificationHelper.LIVE_NOTIF_ID, notif)
    }

    private fun buildLiveNotification(mins: Int): Notification {
        val launchIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_STOP_CODE, stopCode)
            putExtra(MainActivity.EXTRA_STOP_NAME, stopName)
        }
        val pLaunch = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val stopIntent = Intent(this, NotificationActionReceiver::class.java).apply {
            action = NotificationActionReceiver.ACTION_STOP_TRACKING
            putExtra(NotificationActionReceiver.EXTRA_STOP_CODE, stopCode)
            putExtra(NotificationActionReceiver.EXTRA_LINE_ID, lineId)
        }
        val pStop = PendingIntent.getBroadcast(
            this,
            1,
            stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val timeFormatted = NotificationHelper.formatMinutesHuman(mins)
        val shortText = if (mins <= 0) "ΤΩΡΑ" else "${mins}'"
        val cleanDest = NotificationHelper.cleanDestination(destination)
        val dirPart = if (cleanDest.isNotBlank()) " προς $cleanDest" else ""
        val title = if (mins <= 0) "🚨 $lineId$dirPart • ΕΦΤΑΣΕ!" else "🚍 $lineId$dirPart • σε $timeFormatted"
        val content = "📍 Στάση: $stopName"

        val maxMins = kotlin.math.max(1, initialMinutes)
        val progress = kotlin.math.min(maxMins, kotlin.math.max(0, maxMins - mins))

        val extras = android.os.Bundle().apply {
            putBoolean("android.requestPromotedOngoing", true)
            putCharSequence("android.shortCriticalText", shortText)
            putCharSequence("android.substName", shortText)
            putString("android.template", "android.app.Notification\$BigTextStyle")
        }

        val accentColor = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            androidx.core.content.ContextCompat.getColor(this, android.R.color.system_accent1_600)
        } else {
            0xFF005AC1.toInt()
        }

        val targetTimestamp = System.currentTimeMillis() + (mins * 60 * 1000L)

        val notif: Notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nBuilder = Notification.Builder(this, NotificationHelper.LIVE_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification_bus)
                .setContentTitle(title)
                .setContentText(content)
                .setSubText(shortText)
                .setStyle(
                    Notification.BigTextStyle()
                        .bigText("$content\n$title")
                        .setSummaryText(shortText)
                )
                .setProgress(maxMins, progress, false)
                .setOngoing(true)
                .setAutoCancel(false)
                .setOnlyAlertOnce(true)
                .setColor(accentColor)
                .setColorized(true)
                .setContentIntent(pLaunch)
                .setWhen(targetTimestamp)
                .setShowWhen(true)
                .setUsesChronometer(mins > 0)
                .setChronometerCountDown(true)
                .setCategory(Notification.CATEGORY_STATUS)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .addExtras(extras)
                .addAction(
                    Notification.Action.Builder(
                        Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel),
                        "🛑 Τερματισμός",
                        pStop
                    ).build()
                )

            try {
                val mPromote = nBuilder.javaClass.getMethod("setRequestPromotedOngoing", Boolean::class.javaPrimitiveType)
                mPromote.invoke(nBuilder, true)
            } catch (e: Throwable) {}

            try {
                val mShort = nBuilder.javaClass.getMethod("setShortCriticalText", CharSequence::class.java)
                mShort.invoke(nBuilder, shortText)
            } catch (e: Throwable) {}

            nBuilder.build()
        } else {
            val builder = NotificationCompat.Builder(this, NotificationHelper.LIVE_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification_bus)
                .setContentTitle(title)
                .setContentText(content)
                .setSubText(shortText)
                .setStyle(
                    NotificationCompat.BigTextStyle()
                        .bigText("$content\n$title")
                        .setSummaryText(shortText)
                )
                .setProgress(maxMins, progress, false)
                .setOngoing(true)
                .setAutoCancel(false)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setColor(accentColor)
                .setColorized(true)
                .setContentIntent(pLaunch)
                .setWhen(targetTimestamp)
                .setShowWhen(true)
                .setUsesChronometer(mins > 0)
                .setChronometerCountDown(true)
                .addExtras(extras)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "🛑 Τερματισμός", pStop)

            builder.build()
        }

        try {
            notif.extras.putBoolean("android.requestPromotedOngoing", true)
            notif.extras.putCharSequence("android.shortCriticalText", shortText)
            notif.extras.putCharSequence("android.substName", shortText)
            notif.extras.putString("android.template", "android.app.Notification\$BigTextStyle")
        } catch (e: Throwable) {}

        return notif
    }

    private fun triggerAlarmWakeup(minsAway: Int) {
        if (ringUntilDismissed) {
            AlarmRingingService.start(this, lineId, stopName, minsAway, stopCode)
        } else {
            NotificationHelper.showBusAlarmNotification(this, lineId, stopName, minsAway, stopCode)
        }
    }

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
        pollingJob?.cancel()
        serviceJob.cancel()
    }
}
