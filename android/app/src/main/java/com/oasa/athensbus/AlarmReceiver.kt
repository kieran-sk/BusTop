package com.oasa.athensbus

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val lineId = intent.getStringExtra("EXTRA_LINE_ID") ?: "BUS"
        val stopName = intent.getStringExtra("EXTRA_STOP_NAME") ?: "Στάση ΟΑΣΑ"
        val minutesAway = intent.getIntExtra("EXTRA_MINUTES_AWAY", 5)

        // 1. Wake up the phone screen even if device is locked or in deep sleep
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        @Suppress("DEPRECATION")
        val wakeLock = powerManager.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
            "BusTop:AlarmWakeLock"
        )
        wakeLock.acquire(15000)

        // 2. Play Alarm Sound directly through Alarm Audio Stream (ignores silent mode)
        try {
            val alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            val ringtone = RingtoneManager.getRingtone(context.applicationContext, alarmUri)
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

        // 3. Vibrate device with repeating transit alert pattern
        try {
            val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 800, 200, 800, 200, 800, 1000), -1))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(longArrayOf(0, 800, 200, 800, 200, 800, 1000), -1)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        // 4. Show Heads-up High-Priority Alarm Notification
        NotificationHelper.showBusAlarmNotification(context, lineId, stopName, minutesAway)
    }
}