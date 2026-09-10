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
        val ringUntilDismissed = intent.getBooleanExtra("EXTRA_RING_UNTIL_DISMISSED", true)

        if (ringUntilDismissed) {
            AlarmRingingService.start(context, lineId, stopName, minutesAway)
        } else {
            val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            @Suppress("DEPRECATION")
            val wakeLock = powerManager.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
                "BusTop:AlarmWakeLock"
            )
            wakeLock.acquire(15000)

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

            NotificationHelper.showBusAlarmNotification(context, lineId, stopName, minutesAway)
        }
    }
}
