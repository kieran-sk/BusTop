package com.oasa.athensbus

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

object WatchSyncManager {
    private const val TAG = "WatchSyncManager"

    const val PATH_LAUNCH_PINS = "/bustop/launch_pins"
    const val PATH_UPDATE_PINS = "/bustop/update_pins"
    const val PATH_SHARE_ARRIVALS = "/bustop/share_arrivals"
    const val PATH_LAUNCH = "/bustop/launch"

    private val scope = CoroutineScope(Dispatchers.IO)

    fun sendLaunchPins(context: Context, pinsJson: String, onComplete: ((Boolean) -> Unit)? = null) {
        sendMessageToWear(context, PATH_LAUNCH_PINS, pinsJson, onComplete)
    }

    fun sendUpdatePins(context: Context, pinsJson: String, onComplete: ((Boolean) -> Unit)? = null) {
        sendMessageToWear(context, PATH_UPDATE_PINS, pinsJson, onComplete)
    }

    fun shareStopArrivals(context: Context, arrivalsPayload: String, onComplete: ((Boolean) -> Unit)? = null) {
        sendMessageToWear(context, PATH_SHARE_ARRIVALS, arrivalsPayload, onComplete)
    }

    fun launchWatchApp(context: Context, onComplete: ((Boolean) -> Unit)? = null) {
        sendMessageToWear(context, PATH_LAUNCH, "launch", onComplete)
    }

    private fun sendMessageToWear(
        context: Context,
        path: String,
        payload: String,
        onComplete: ((Boolean) -> Unit)?
    ) {
        scope.launch {
            try {
                val nodeClient = Wearable.getNodeClient(context)
                val messageClient = Wearable.getMessageClient(context)
                val nodes = nodeClient.connectedNodes.await()

                if (nodes.isEmpty()) {
                    Log.w(TAG, "No Wear OS nodes connected.")
                    onComplete?.invoke(false)
                    return@launch
                }

                val dataBytes = payload.toByteArray(Charsets.UTF_8)
                var successCount = 0

                for (node in nodes) {
                    try {
                        messageClient.sendMessage(node.id, path, dataBytes).await()
                        Log.d(TAG, "Successfully sent message $path to watch node: ${node.displayName} (${node.id})")
                        successCount++
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed sending to node ${node.id}", e)
                    }
                }

                onComplete?.invoke(successCount > 0)
            } catch (e: Exception) {
                Log.e(TAG, "Wearable sendMessageToWear error", e)
                onComplete?.invoke(false)
            }
        }
    }
}
