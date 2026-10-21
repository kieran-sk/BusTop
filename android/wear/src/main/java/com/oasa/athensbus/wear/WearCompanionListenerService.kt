package com.oasa.athensbus.wear

import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

class WearCompanionListenerService : WearableListenerService() {

    companion object {
        private const val TAG = "WearCompanionService"
        const val PATH_LAUNCH_PINS = "/bustop/launch_pins"
        const val PATH_UPDATE_PINS = "/bustop/update_pins"
        const val PATH_SHARE_ARRIVALS = "/bustop/share_arrivals"
        const val PATH_LAUNCH = "/bustop/launch"

        const val ACTION_SYNC_PINS = "com.oasa.athensbus.wear.SYNC_PINS"
        const val ACTION_SHOW_ARRIVALS = "com.oasa.athensbus.wear.SHOW_ARRIVALS"
        const val EXTRA_PAYLOAD = "extra_payload"
    }

    override fun onMessageReceived(messageEvent: MessageEvent) {
        val path = messageEvent.path
        val data = String(messageEvent.data, Charsets.UTF_8)
        Log.d(TAG, "Wear companion message received: path=$path")

        when (path) {
            PATH_LAUNCH_PINS, PATH_UPDATE_PINS -> {
                // Save pins to SharedPreferences so they persist
                try {
                    val prefs = getSharedPreferences("BusTopWatch", Context.MODE_PRIVATE)
                    prefs.edit().putString("pinned_trips", data).apply()

                    getSharedPreferences("OASA_PERSISTENT_DATA", Context.MODE_PRIVATE)
                        .edit().putString("OASA_PINNED_ARRIVALS", data).apply()
                } catch (e: Exception) {
                    Log.e(TAG, "Error caching pins to SharedPreferences", e)
                }

                // If MainActivity is active, notify it
                MainActivity.instance?.onPinsReceived(data, shouldNavigateToPins = (path == PATH_LAUNCH_PINS))
                    ?: run {
                        // Launch MainActivity with pins intent
                        val launchIntent = Intent(this, MainActivity::class.java).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                            putExtra(EXTRA_PAYLOAD, data)
                            action = ACTION_SYNC_PINS
                        }
                        startActivity(launchIntent)
                    }
            }

            PATH_SHARE_ARRIVALS -> {
                Log.d(TAG, "Shared arrivals received: $data")
                MainActivity.instance?.onArrivalsReceived(data)
                    ?: run {
                        val launchIntent = Intent(this, MainActivity::class.java).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                            putExtra(EXTRA_PAYLOAD, data)
                            action = ACTION_SHOW_ARRIVALS
                        }
                        startActivity(launchIntent)
                    }
            }

            PATH_LAUNCH -> {
                MainActivity.instance?.let {
                    // App already open, bring to front if needed
                } ?: run {
                    val launchIntent = Intent(this, MainActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    }
                    startActivity(launchIntent)
                }
            }
        }
    }
}
