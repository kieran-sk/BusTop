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
    private var ringUntilDismissed: Boolean = true
    private var isAlarmTriggered = false

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
            ringUntilDismissed: Boolean = true
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
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        stopCode = intent?.getStringExtra(EXTRA_STOP_CODE) ?: ""
        lineId = intent?.getStringExtra(EXTRA_LINE_ID) ?: ""
        routeCode = intent?.getStringExtra(EXTRA_ROUTE_CODE) ?: ""
        stopName = intent?.getStringExtra(EXTRA_STOP_NAME) ?: "Στάση ΟΑΣΑ"
        destination = intent?.getStringExtra(EXTRA_DESTINATION) ?: ""
        walkMinutes = intent?.getIntExtra(EXTRA_WALK_MINUTES, 0) ?: 0
        thresholdMinutes = intent?.getIntExtra(EXTRA_THRESHOLD, 5) ?: 5
        ringUntilDismissed = intent?.getBooleanExtra(EXTRA_RING_UNTIL_DISMISSED, true) ?: true
        isAlarmTriggered = false

        NotificationHelper.createLiveNotificationChannel(this)
        val initialNotif = buildLiveNotification(10)
        startForeground(NotificationHelper.LIVE_NOTIF_ID, initialNotif)

        startBackgroundPolling()

        return START_STICKY
    }

    private fun startBackgroundPolling() {
        serviceScope.launch {
            while (isActive) {
                try {
                    val remainingMins = fetchLiveArrivalMinutes()
                    if (remainingMins != null) {
                        updateNotification(remainingMins)

                        if (remainingMins <= thresholdMinutes && !isAlarmTriggered) {
                            isAlarmTriggered = true
                            triggerAlarmWakeup(remainingMins)
                        }
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
                    for (i in 0 until arrivals.length()) {
                        val arr = arrivals.getJSONObject(i)
                        val arrLine = arr.optString("line_id", "")
                        val arrRoute = arr.optString("route_code", "")

                        if (arrLine.equals(lineId, ignoreCase = true) &&
                            (routeCode.isBlank() || arrRoute == routeCode)) {
                            return arr.optInt("btime2", 0)
                        }
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
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
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
        val title = if (mins <= 0) "🚨 Γραμμή $lineId • ΕΦΤΑΣΕ ΣΤΗ ΣΤΑΣΗ!" else "🚍 Γραμμή $lineId • σε $timeFormatted"
        val subtitle = if (destination.isNotBlank()) "Προς $destination" else "Live Tracker"

        val sb = StringBuilder()
        sb.append("📍 Στάση: ").append(stopName).append("\n")
        if (destination.isNotBlank()) {
            sb.append("🏁 Προορισμός: ").append(destination).append("\n")
        }
        if (walkMinutes > 0) {
            sb.append("🚶 Χρόνος βαδίσματος: ~").append(NotificationHelper.formatMinutesHuman(walkMinutes)).append(" (απόσταση)\n")
        }
        sb.append("⏳ Εκτίμηση άφιξης: ")
        if (mins <= 0) {
            sb.append("ΤΩΡΑ στη στάση!\n")
        } else {
            sb.append("σε ").append(timeFormatted).append(" (ειδοποίηση στα ").append(NotificationHelper.formatMinutesHuman(thresholdMinutes)).append(")\n")
        }
        sb.append("📡 Ζωντανή τηλεματική GPS ΟΑΣΑ")

        return NotificationCompat.Builder(this, NotificationHelper.LIVE_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText("Στάση: $stopName • σε $timeFormatted")
            .setSubText(subtitle)
            .setStyle(NotificationCompat.BigTextStyle().bigText(sb.toString()))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setColor(0xFF005AC1.toInt())
            .setContentIntent(pLaunch)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "🛑 Τερματισμός", pStop)
            .build()
    }

    private fun triggerAlarmWakeup(minsAway: Int) {
        if (ringUntilDismissed) {
            AlarmRingingService.start(this, lineId, stopName, minsAway)
        } else {
            NotificationHelper.showBusAlarmNotification(this, lineId, stopName, minsAway)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceJob.cancel()
    }
}
