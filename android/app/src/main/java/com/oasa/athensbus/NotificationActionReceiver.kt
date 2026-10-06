package com.oasa.athensbus

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class NotificationActionReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_STOP_TRACKING = "com.oasa.athensbus.ACTION_STOP_TRACKING"
        const val EXTRA_STOP_CODE = "EXTRA_STOP_CODE"
        const val EXTRA_LINE_ID = "EXTRA_LINE_ID"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action == ACTION_STOP_TRACKING) {
            val stopCode = intent.getStringExtra(EXTRA_STOP_CODE) ?: ""
            val lineId = intent.getStringExtra(EXTRA_LINE_ID) ?: ""

            // 1. Instantly dismiss the notification from Android shade
            try {
                val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                nm.cancel(NotificationHelper.LIVE_NOTIF_ID)
            } catch (e: Exception) {
                e.printStackTrace()
            }

            // 2. Stop the live tracking service and clear wakelocks
            try {
                val serviceIntent = Intent(context, LiveTrackingService::class.java).apply {
                    action = LiveTrackingService.ACTION_STOP
                    putExtra(LiveTrackingService.EXTRA_STOP_CODE, stopCode)
                    putExtra(LiveTrackingService.EXTRA_LINE_ID, lineId)
                }
                context.startService(serviceIntent)
            } catch (e: Exception) {
                e.printStackTrace()
            }

            // 3. Clear pinned arrivals in web app so it will never resurrect the tracking service
            try {
                if (stopCode.isNotBlank() && lineId.isNotBlank()) {
                    MainActivity.currentInstance?.unpinAndDismiss(stopCode, lineId)
                } else {
                    MainActivity.currentInstance?.unpinAllAndDismiss()
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
}
