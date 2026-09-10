package com.oasa.athensbus

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat

object NotificationHelper {
    const val CHANNEL_ID = "oasa_bus_proximity_channel"
    const val CHANNEL_NAME = "Bus Proximity Alarms"

    fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, importance).apply {
                description = "Alerts commuters when their Athens bus is approaching the stop"
                enableLights(true)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 300, 150, 300, 150, 400)
            }
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    fun showBusAlarmNotification(context: Context, lineId: String, stopName: String, minutesAway: Int) {
        createNotificationChannel(context)

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("🚌 Bus $lineId is $minutesAway min away!")
            .setContentText("Approaching $stopName. Head to the stop now!")
            .setStyle(NotificationCompat.BigTextStyle().bigText("Bus $lineId is $minutesAway minutes away from $stopName. Time to leave!"))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setSound(defaultSoundUri)
            .setVibrate(longArrayOf(0, 300, 150, 300, 150, 400))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(lineId.hashCode(), notification)
    }

    const val LIVE_CHANNEL_ID = "oasa_bus_live_channel"
    const val LIVE_CHANNEL_NAME = "Live Bus Tracking"
    const val LIVE_NOTIF_ID = 2001

    fun createLiveNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(LIVE_CHANNEL_ID, LIVE_CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shows live ongoing countdown for pinned bus arrivals on lock screen"
                setShowBadge(true)
            }
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    /**
     * Android Native Live Notification (Ongoing / Lock Screen Sticky)
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

        val title = if (minutesAway <= 0) "🚍 Γραμμή $lineId • ΦΘΑΝΕΙ ΤΩΡΑ!" else "🚍 Γραμμή $lineId • σε $minutesAway λεπτά"
        val text = "Στάση: $stopName • Ζωντανή Τηλεματική ΟΑΣΑ"

        val notification = NotificationCompat.Builder(context, LIVE_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(text)
            .setSubText("BusTop Live")
            .setOngoing(true) // Native Android Live Notification
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
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
