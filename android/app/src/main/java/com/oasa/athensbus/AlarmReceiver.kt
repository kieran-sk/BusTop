package com.oasa.athensbus

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val lineId = intent.getStringExtra("EXTRA_LINE_ID") ?: "BUS"
        val stopName = intent.getStringExtra("EXTRA_STOP_NAME") ?: "Your Stop"
        val minutesAway = intent.getIntExtra("EXTRA_MINUTES_AWAY", 5)

        NotificationHelper.showBusAlarmNotification(context, lineId, stopName, minutesAway)
    }
}
