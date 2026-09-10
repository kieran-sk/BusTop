package com.oasa.athensbus

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
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
    private var thresholdMinutes: Int = 5
    private var isAlarmTriggered = false

    companion object {
        const val ACTION_START = "ACTION_START_LIVE_TRACKING"
        const val ACTION_STOP = "ACTION_STOP_LIVE_TRACKING"

        const val EXTRA_STOP_CODE = "EXTRA_STOP_CODE"
        const val EXTRA_LINE_ID = "EXTRA_LINE_ID"
        const val EXTRA_ROUTE_CODE = "EXTRA_ROUTE_CODE"
        const val EXTRA_STOP_NAME = "EXTRA_STOP_NAME"
        const val EXTRA_THRESHOLD = "EXTRA_THRESHOLD"

        fun start(context: Context, stopCode: String, lineId: String, routeCode: String, stopName: String, threshold: Int) {
            val intent = Intent(context, LiveTrackingService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_STOP_CODE, stopCode)
                putExtra(EXTRA_LINE_ID, lineId)
                putExtra(EXTRA_ROUTE_CODE, routeCode)
                putExtra(EXTRA_STOP_NAME, stopName)
                putExtra(EXTRA_THRESHOLD, threshold)
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
        thresholdMinutes = intent?.getIntExtra(EXTRA_THRESHOLD, 5) ?: 5
        isAlarmTriggered = false

        // Start Foreground immediately with Ongoing Live Notification
        NotificationHelper.createLiveNotificationChannel(this)
        val initialNotif = buildLiveNotification("🚍 Γραμμή $lineId • Έναρξη παρακολούθησης", "Στάση: $stopName • Σύνδεση με τηλεματική...", 10)
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

                // Poll every 20 seconds while tracking in the background
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
        val title = if (mins <= 0) "🚨 Γραμμή $lineId • ΕΦΤΑΣΕ ΣΤΗ ΣΤΑΣΗ!" else "🚍 Γραμμή $lineId • σε $mins λεπτά"
        val text = "Στάση: $stopName • Ειδοποίηση στα $thresholdMinutes λεπτά"
        val notif = buildLiveNotification(title, text, mins)
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NotificationHelper.LIVE_NOTIF_ID, notif)
    }

    private fun buildLiveNotification(title: String, text: String, mins: Int): Notification {
        val launchIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pLaunch = PendingIntent.getActivity(this, 0, launchIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

        val stopIntent = Intent(this, LiveTrackingService::class.java).apply {
            action = ACTION_STOP
        }
        val pStop = PendingIntent.getService(this, 1, stopIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

        return NotificationCompat.Builder(this, NotificationHelper.LIVE_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setSubText("BusTop Live Tracker")
            .setOngoing(true) // Keeps it locked on lockscreen like Android Live Notification
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setContentIntent(pLaunch)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Διακοπή", pStop)
            .build()
    }

    private fun triggerAlarmWakeup(minsAway: Int) {
        // 1. Wake up the screen even if locked / phone asleep
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        @Suppress("DEPRECATION")
        val wakeLock = powerManager.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
            "BusTop:AlarmWakeLock"
        )
        wakeLock.acquire(15000)

        // 2. Play Alarm Siren via AudioManager ALARM stream (bypasses silent/vibrate)
        try {
            val alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            val ringtone = RingtoneManager.getRingtone(applicationContext, alarmUri)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                ringtone.audioAttributes = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            }
            ringtone.play()
        } catch (e: Exception) {
            e.printStackTrace()
        }

        // 3. Vibrate intensely
        val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 800, 200, 800, 200, 800, 1000), -1))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(longArrayOf(0, 800, 200, 800, 200, 800, 1000), -1)
        }

        // 4. Show Fullscreen Heads-up Alarm Notification
        NotificationHelper.showBusAlarmNotification(this, lineId, stopName, minsAway)
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceJob.cancel()
    }
}