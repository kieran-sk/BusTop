package com.oasa.athensbus

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
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

    private var stopCode: String = ""
    private var lineId: String = ""
    private var routeCode: String = ""
    private var stopName: String = ""
    private var destination: String = ""
    private var walkMinutes: Int = 0
    private var thresholdMinutes: Int = 5
    private var initialMinutes: Int = 10
    private var startedAtMs: Long = 0L
    private var ringUntilDismissed: Boolean = true
    private var isAlarmTriggered = false
    private var wakeLock: PowerManager.WakeLock? = null

    companion object {
        const val ACTION_START = "ACTION_START_LIVE_TRACKING"
        const val ACTION_STOP = "ACTION_STOP_LIVE_TRACKING"

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
            ringUntilDismissed: Boolean = true,
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
                context.startForegroundService(intent)
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
            releaseWakeLock()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        acquireWakeLock()

        stopCode = intent?.getStringExtra(EXTRA_STOP_CODE) ?: ""
        lineId = intent?.getStringExtra(EXTRA_LINE_ID) ?: ""
        routeCode = intent?.getStringExtra(EXTRA_ROUTE_CODE) ?: ""
        stopName = intent?.getStringExtra(EXTRA_STOP_NAME) ?: "Στάση ΟΑΣΑ"
        destination = intent?.getStringExtra(EXTRA_DESTINATION) ?: ""
        walkMinutes = intent?.getIntExtra(EXTRA_WALK_MINUTES, 0) ?: 0
        thresholdMinutes = intent?.getIntExtra(EXTRA_THRESHOLD, 5) ?: 5
        initialMinutes = intent?.getIntExtra(EXTRA_INITIAL_MINS, 10) ?: 10
        startedAtMs = System.currentTimeMillis()
        ringUntilDismissed = intent?.getBooleanExtra(EXTRA_RING_UNTIL_DISMISSED, true) ?: true
        isAlarmTriggered = false

        NotificationHelper.createLiveNotificationChannel(this)
        val initialNotif = buildLiveNotification(initialMinutes)
        startForeground(NotificationHelper.LIVE_NOTIF_ID, initialNotif)

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
        serviceScope.launch {
            while (isActive) {
                try {
                    // Try fetching live GPS telemetry from API
                    var remainingMins = fetchLiveArrivalMinutes()

                    // Fallback to elapsed time if GPS is temporarily absent or network drops
                    if (remainingMins == null) {
                        val elapsedMins = ((System.currentTimeMillis() - startedAtMs) / 60000L).toInt()
                        remainingMins = kotlin.math.max(0, initialMinutes - elapsedMins)
                    }

                    updateNotification(remainingMins)

                    if (remainingMins <= thresholdMinutes && !isAlarmTriggered) {
                        isAlarmTriggered = true
                        triggerAlarmWakeup(remainingMins)
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }

                delay(20000)
            }
        }
    }

    private fun fetchLiveArrivalMinutes(): Int? {
        if (stopCode.isBlank()) return null
        return try {
            val url = URL("https://bustop.pages.dev/api/stops/$stopCode/arrivals")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.setRequestProperty("Accept", "application/json")

            if (conn.responseCode == 200) {
                val reader = BufferedReader(InputStreamReader(conn.inputStream))
                val response = reader.readText()
                reader.close()

                val json = JSONObject(response)
                val arrivals = json.optJSONArray("arrivals")
                if (arrivals != null) {
                    val elapsedMins = ((System.currentTimeMillis() - startedAtMs) / 60000L).toInt()
                    val expectedMins = kotlin.math.max(0, initialMinutes - elapsedMins)

                    var bestDiff = Int.MAX_VALUE
                    var bestArrivalMins: Int? = null

                    for (i in 0 until arrivals.length()) {
                        val arr = arrivals.getJSONObject(i)
                        val arrLine = arr.optString("line_id", "")
                        val arrRoute = arr.optString("route_code", "")

                        if (arrLine.equals(lineId, ignoreCase = true) &&
                            (routeCode.isBlank() || arrRoute.isBlank() || arrRoute == routeCode)) {
                            val btime2 = arr.optInt("btime2", -1)
                            if (btime2 >= 0) {
                                val diff = kotlin.math.abs(btime2 - expectedMins)
                                // Only consider arrivals within a reasonable window of the expected tracked bus
                                if (diff < bestDiff && (btime2 <= expectedMins + 20 || diff <= 15)) {
                                    bestDiff = diff
                                    bestArrivalMins = btime2
                                }
                            }
                        }
                    }
                    if (bestArrivalMins != null) {
                        return bestArrivalMins
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

        val stopIntent = Intent(this, LiveTrackingService::class.java).apply {
            action = ACTION_STOP
        }
        val pStop = PendingIntent.getService(
            this,
            1,
            stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val timeFormatted = NotificationHelper.formatMinutesHuman(mins)
        val shortText = if (mins <= 0) "ΤΩΡΑ" else "${mins}λ"
        val dirPart = if (destination.isNotBlank()) " προς $destination" else ""
        val title = if (mins <= 0) "🚨 $lineId$dirPart • ΕΦΤΑΣΕ!" else "🚍 $lineId$dirPart • σε $timeFormatted"
        val content = "📍 Στάση: $stopName"

        val maxMins = kotlin.math.max(1, initialMinutes)
        val progress = kotlin.math.min(maxMins, kotlin.math.max(0, maxMins - mins))

        val extras = android.os.Bundle().apply {
            putBoolean("android.requestPromotedOngoing", true)
            putCharSequence("android.shortCriticalText", shortText)
            putCharSequence("android.substName", shortText)
        }

        val builder = NotificationCompat.Builder(this, NotificationHelper.LIVE_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(content)
            .setSubText(shortText)
            .setProgress(maxMins, progress, false)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setColor(0xFF005AC1.toInt())
            .setContentIntent(pLaunch)
            .addExtras(extras)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "🛑 Τερματισμός", pStop)

        try {
            val method = builder.javaClass.getMethod("setShortCriticalText", CharSequence::class.java)
            method.invoke(builder, shortText)
        } catch (e: Throwable) {}

        val notif = builder.build()
        try {
            notif.extras.putCharSequence("android.shortCriticalText", shortText)
            notif.extras.putBoolean("android.requestPromotedOngoing", true)
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
        serviceJob.cancel()
    }
}
