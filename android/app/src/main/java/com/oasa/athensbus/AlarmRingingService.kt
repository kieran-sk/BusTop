package com.oasa.athensbus

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat

class AlarmRingingService : Service() {

    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var wakeLock: PowerManager.WakeLock? = null

    companion object {
        const val ACTION_START = "ACTION_START_ALARM_RINGING"
        const val ACTION_DISMISS = "ACTION_DISMISS_ALARM_RINGING"

        const val EXTRA_LINE_ID = "EXTRA_LINE_ID"
        const val EXTRA_STOP_NAME = "EXTRA_STOP_NAME"
        const val EXTRA_MINS = "EXTRA_MINS"
        const val EXTRA_STOP_CODE = "EXTRA_STOP_CODE"

        const val NOTIFICATION_ID = 3001
        const val CHANNEL_ID = "oasa_bus_continuous_alarm_v5"

        fun start(context: Context, lineId: String, stopName: String, minsAway: Int, stopCode: String = "") {
            val intent = Intent(context, AlarmRingingService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_LINE_ID, lineId)
                putExtra(EXTRA_STOP_NAME, stopName)
                putExtra(EXTRA_MINS, minsAway)
                putExtra(EXTRA_STOP_CODE, stopCode)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun dismiss(context: Context) {
            val intent = Intent(context, AlarmRingingService::class.java).apply {
                action = ACTION_DISMISS
            }
            context.startService(intent)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_DISMISS) {
            stopAlarm()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        val lineId = intent?.getStringExtra(EXTRA_LINE_ID) ?: "BUS"
        val stopName = intent?.getStringExtra(EXTRA_STOP_NAME) ?: "Στάση ΟΑΣΑ"
        val minsAway = intent?.getIntExtra(EXTRA_MINS, 5) ?: 5
        val stopCode = intent?.getStringExtra(EXTRA_STOP_CODE) ?: ""

        acquireWakeLock()
        createNotificationChannel()

        val notification = buildAlarmNotification(lineId, stopName, minsAway, stopCode)
        startForeground(NOTIFICATION_ID, notification)

        startSoundAndVibration()

        return START_STICKY
    }

    private fun acquireWakeLock() {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            @Suppress("DEPRECATION")
            wakeLock = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
                "BusTop:AlarmRingingWakeLock"
            )
            wakeLock?.acquire(300000)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Bus Alarm Siren (Continuous)",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Loud continuous siren until dismissed"
                enableVibration(true)
                enableLights(true)
                setBypassDnd(true)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
            }
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildAlarmNotification(lineId: String, stopName: String, minsAway: Int, stopCode: String = ""): Notification {
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_STOP_CODE, stopCode)
            putExtra(MainActivity.EXTRA_STOP_NAME, stopName)
        }
        val pOpenApp = PendingIntent.getActivity(
            this,
            0,
            openAppIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val dismissIntent = Intent(this, AlarmRingingService::class.java).apply {
            action = ACTION_DISMISS
        }
        val pDismiss = PendingIntent.getService(
            this,
            1,
            dismissIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val timeFormatted = NotificationHelper.formatMinutesHuman(minsAway)
        val title = "🚨 Συναγερμός: Λεωφορείο $lineId • $timeFormatted!"
        val bigText = "📍 Στάση: $stopName\n⏰ Απομένουν $timeFormatted μέχρι την άφιξη!\n👉 Πατήστε 'ΑΠΕΝΕΡΓΟΠΟΙΗΣΗ' για διακοπή του ήχου."

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText("Στάση: $stopName • Πλησιάζει τώρα!")
            .setStyle(NotificationCompat.BigTextStyle().bigText(bigText))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setFullScreenIntent(pOpenApp, true)
            .setContentIntent(pOpenApp)
            .setOngoing(true)
            .setAutoCancel(false)
            .setColor(0xFFDC2626.toInt())
            .addAction(android.R.drawable.ic_lock_power_off, "🔕 ΑΠΕΝΕΡΓΟΠΟΙΗΣΗ", pDismiss)
            .build()
    }

    private fun startSoundAndVibration() {
        try {
            val soundUri: Uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

            mediaPlayer = MediaPlayer().apply {
                setDataSource(applicationContext, soundUri)
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                isLooping = true
                prepare()
                start()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        try {
            vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            val pattern = longArrayOf(0, 800, 400, 800, 400, 800, 800)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(pattern, 0)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun stopAlarm() {
        try {
            if (mediaPlayer?.isPlaying == true) {
                mediaPlayer?.stop()
            }
            mediaPlayer?.release()
            mediaPlayer = null
        } catch (e: Exception) {
            e.printStackTrace()
        }

        try {
            vibrator?.cancel()
            vibrator = null
        } catch (e: Exception) {
            e.printStackTrace()
        }

        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
            wakeLock = null
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    override fun onDestroy() {
        stopAlarm()
        super.onDestroy()
    }
}
