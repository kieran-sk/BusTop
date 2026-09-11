package com.oasa.athensbus

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat

object NotificationHelper {
    const val CHANNEL_ID = "oasa_bus_proximity_channel_v5"
    const val CHANNEL_NAME = "Bus Proximity Alarms"

    fun formatMinutesHuman(mins: Int): String {
        if (mins < 60) return "${mins}λ"
        val hours = mins / 60
        val rem = mins % 60
        return if (rem > 0) "${hours}ω ${rem}λ" else "${hours}ω"
    }

    fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

            val audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()

            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, importance).apply {
                description = "Alerts commuters when their Athens bus is approaching the stop"
                enableLights(true)
                enableVibration(true)
                setSound(defaultSoundUri, audioAttributes)
                setBypassDnd(true)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
                vibrationPattern = longArrayOf(0, 800, 200, 800, 200, 800, 1000)
            }
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    fun showBusAlarmNotification(context: Context, lineId: String, stopName: String, minutesAway: Int, stopCode: String = "") {
        createNotificationChannel(context)

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_STOP_CODE, stopCode)
            putExtra(MainActivity.EXTRA_STOP_NAME, stopName)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            lineId.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

        val timeFormatted = formatMinutesHuman(minutesAway)
        val bigText = "Το λεωφορείο $lineId απέχει $timeFormatted από τη στάση $stopName.\n\nΏρα να κατευθυνθείτε προς τη στάση!"

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("🚨 Λεωφορείο $lineId • σε $timeFormatted!")
            .setContentText("Στάση: $stopName • Πλησιάζει τώρα!")
            .setStyle(NotificationCompat.BigTextStyle().bigText(bigText))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setFullScreenIntent(pendingIntent, true)
            .setSound(defaultSoundUri)
            .setVibrate(longArrayOf(0, 800, 200, 800, 200, 800, 1000))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(lineId.hashCode(), notification)
    }

    const val LIVE_CHANNEL_ID = "oasa_bus_live_channel_v5"
    const val LIVE_CHANNEL_NAME = "Live Bus Tracking"
    const val LIVE_NOTIF_ID = 2001

    fun createLiveNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(LIVE_CHANNEL_ID, LIVE_CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Rich Ongoing Live Activity pill showing bus arrival countdown, stop, and status"
                setShowBadge(true)
                setSound(null, null)
                enableVibration(false)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
            }
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    fun updateLiveArrivalNotification(
        context: Context,
        lineId: String,
        minutesAway: Int,
        stopName: String,
        destination: String = "",
        walkMinutes: Int = 0,
        stopCode: String = "",
        initialMinutes: Int = 10
    ) {
        createLiveNotificationChannel(context)

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_STOP_CODE, stopCode)
            putExtra(MainActivity.EXTRA_STOP_NAME, stopName)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            LIVE_NOTIF_ID,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val stopIntent = Intent(context, LiveTrackingService::class.java).apply {
            action = LiveTrackingService.ACTION_STOP
        }
        val pStop = PendingIntent.getService(
            context,
            LIVE_NOTIF_ID + 1,
            stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val timeFormatted = formatMinutesHuman(minutesAway)
        val title = if (minutesAway <= 0) "🚨 Γραμμή $lineId • ΕΦΤΑΣΕ!" else "🚍 Γραμμή $lineId • σε $timeFormatted"
        val content = "📍 Στάση: $stopName"

        val maxMins = kotlin.math.max(1, initialMinutes)
        val progress = kotlin.math.min(maxMins, kotlin.math.max(0, maxMins - minutesAway))

        val extras = android.os.Bundle().apply {
            putBoolean("android.requestPromotedOngoing", true)
        }

        val notification = NotificationCompat.Builder(context, LIVE_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(content)
            .setProgress(maxMins, progress, false)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setColor(0xFF005AC1.toInt())
            .setContentIntent(pendingIntent)
            .addExtras(extras)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "🛑 Τερματισμός", pStop)
            .build()

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(LIVE_NOTIF_ID, notification)
    }

    fun clearLiveArrivalNotification(context: Context) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.cancel(LIVE_NOTIF_ID)
    }
}
