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
    const val CHANNEL_ID = "oasa_bus_proximity_channel_v3"
    const val CHANNEL_NAME = "Bus Proximity Alarms"

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

    fun showBusAlarmNotification(context: Context, lineId: String, stopName: String, minutesAway: Int) {
        createNotificationChannel(context)

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
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

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("🚨 Λεωφορείο $lineId: $minutesAway λεπτά απομένουν!")
            .setContentText("Πλησιάζει στη στάση $stopName. Ώρα αναχώρησης!")
            .setStyle(NotificationCompat.BigTextStyle().bigText("Το λεωφορείο $lineId απέχει $minutesAway λεπτά από τη στάση $stopName. Ξεκινήστε για τη στάση!"))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setFullScreenIntent(pendingIntent, true) // Turns screen ON immediately on locked device
            .setSound(defaultSoundUri)
            .setVibrate(longArrayOf(0, 800, 200, 800, 200, 800, 1000))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(lineId.hashCode(), notification)
    }

    const val LIVE_CHANNEL_ID = "oasa_bus_live_channel_v3"
    const val LIVE_CHANNEL_NAME = "Live Bus Tracking"
    const val LIVE_NOTIF_ID = 2001

    fun createLiveNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(LIVE_CHANNEL_ID, LIVE_CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Shows live ongoing countdown for pinned bus arrivals on lock screen"
                setShowBadge(true)
                setSound(null, null)
                enableVibration(false)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
            }
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    /**
     * Android Native Live Notification (Rich Ongoing Status Bar Pill & Lock Screen)
     */
    fun updateLiveArrivalNotification(context: Context, lineId: String, minutesAway: Int, stopName: String) {
        createLiveNotificationChannel(context)

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            LIVE_NOTIF_ID,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val title = if (minutesAway <= 0) "🚨 Γραμμή $lineId • ΕΦΤΑΣΕ ΣΤΗ ΣΤΑΣΗ!" else "🚍 Γραμμή $lineId • σε $minutesAway λεπτά"
        val text = "Στάση: $stopName • Ζωντανό GPS ΟΑΣΑ"

        val notification = NotificationCompat.Builder(context, LIVE_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setSubText("Live Activity")
            .setOngoing(true) // Android Live Notification
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setColor(0xFF005AC1.toInt())
            .setContentIntent(pendingIntent)
            .build()

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(LIVE_NOTIF_ID, notification)
    }

    fun clearLiveArrivalNotification(context: Context) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.cancel(LIVE_NOTIF_ID)
    }
}