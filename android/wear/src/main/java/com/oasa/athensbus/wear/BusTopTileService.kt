package com.oasa.athensbus.wear

import android.content.Context
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.sp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.LayoutElementBuilders.FONT_WEIGHT_BOLD
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.guava.future
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class BusTopTileService : TileService() {

    private val serviceScope = CoroutineScope(Dispatchers.IO)
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .build()

    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        return serviceScope.future {
            val arrivals = fetchPinnedArrivals()
            val layout = buildTileLayout(arrivals)

            val timeline = TimelineBuilders.Timeline.Builder()
                .addTimelineEntry(
                    TimelineBuilders.TimelineEntry.Builder()
                        .setLayout(layout)
                        .build()
                )
                .build()

            TileBuilders.Tile.Builder()
                .setResourcesVersion("1")
                .setTileTimeline(timeline)
                .setFreshnessIntervalMillis(45_000L) // Refresh every 45s
                .build()
        }
    }

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> {
        return Futures.immediateFuture(
            ResourceBuilders.Resources.Builder()
                .setVersion("1")
                .build()
        )
    }

    data class PinnedTrip(
        val stopCode: String,
        val stopName: String,
        val lineId: String
    )

    private fun loadPinnedItems(): List<PinnedTrip> {
        val list = mutableListOf<PinnedTrip>()
        val prefsList = listOf(
            getSharedPreferences("OASA_PERSISTENT_DATA", Context.MODE_PRIVATE),
            getSharedPreferences("BusTopWatch", Context.MODE_PRIVATE)
        )
        for (p in prefsList) {
            val raw = p.getString("OASA_PINNED_ARRIVALS", null) ?: p.getString("pinned_trips", null)
            if (!raw.isNullOrBlank() && raw != "[]" && raw != "null") {
                try {
                    val arr = JSONArray(raw)
                    for (i in 0 until arr.length()) {
                        val obj = arr.getJSONObject(i)
                        val stopCode = obj.optString("stopCode", obj.optString("code", ""))
                        val lineId = obj.optString("lineId", obj.optString("line", "BUS"))
                        val stopName = obj.optString("stopName", "Στάση $stopCode")
                        if (stopCode.isNotEmpty() && lineId.isNotEmpty() && list.none { it.stopCode == stopCode && it.lineId == lineId }) {
                            list.add(PinnedTrip(stopCode = stopCode, stopName = stopName, lineId = lineId))
                        }
                    }
                } catch (_: Exception) {}
            }
        }
        return list
    }

    private fun removePinnedItem(stopCode: String, lineId: String) {
        val currentPins = loadPinnedItems().toMutableList()
        currentPins.removeAll { it.stopCode == stopCode && it.lineId.equals(lineId, ignoreCase = true) }

        val jsonArr = JSONArray()
        currentPins.forEach { pin ->
            val obj = JSONObject()
            obj.put("stopCode", pin.stopCode)
            obj.put("stopName", pin.stopName)
            obj.put("lineId", pin.lineId)
            jsonArr.put(obj)
        }

        listOf(
            getSharedPreferences("OASA_PERSISTENT_DATA", Context.MODE_PRIVATE),
            getSharedPreferences("BusTopWatch", Context.MODE_PRIVATE)
        ).forEach { prefs ->
            prefs.edit()
                .putString("OASA_PINNED_ARRIVALS", jsonArr.toString())
                .putString("pinned_trips", jsonArr.toString())
                .apply()
        }
    }

    private fun fetchPinnedArrivals(): List<WatchArrival> {
        val pinned = loadPinnedItems()
        if (pinned.isEmpty()) {
            return emptyList()
        }

        val results = mutableListOf<WatchArrival>()
        for (pin in pinned) {
            val arr = tryFetchForStop(pin.stopCode, pin.stopName, targetLine = pin.lineId)
            if (arr != null) {
                // If bus has arrived / passed (mins <= 0), automatically unpin it!
                if (arr.minsRemaining <= 0) {
                    removePinnedItem(pin.stopCode, pin.lineId)
                } else {
                    results.add(arr)
                }
            }
        }
        return results.sortedBy { it.minsRemaining }
    }

    private fun tryFetchForStop(code: String, sName: String, targetLine: String): WatchArrival? {
        return try {
            val lineMap = fetchRouteMap(code)
            val url = "https://telematics.oasa.gr/api/?act=getStopArrivals&p1=$code"
            val req = Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android Wear OS; BusTop)")
                .build()
            val response = httpClient.newCall(req).execute()
            val body = response.body?.string() ?: ""
            if (body.isNotEmpty() && body != "null") {
                val json = JSONArray(body)
                if (json.length() > 0) {
                    var selectedObj: JSONObject? = null
                    for (idx in 0 until json.length()) {
                        val candidate = json.getJSONObject(idx)
                        val rCode = candidate.optString("route_code")
                        val lId = lineMap[rCode] ?: rCode
                        if (lId.equals(targetLine, ignoreCase = true)) {
                            selectedObj = candidate
                            break
                        }
                    }

                    if (selectedObj != null) {
                        val routeCode = selectedObj.optString("route_code")
                        val btime = selectedObj.optInt("btime2", -1)
                        val mins = if (btime >= 0) btime else selectedObj.optString("btime2").toIntOrNull() ?: 0
                        val lineId = lineMap[routeCode] ?: targetLine
                        WatchArrival(
                            stopName = sName,
                            routeId = lineId,
                            minsRemaining = mins,
                            destination = sName
                        )
                    } else null
                } else null
            } else null
        } catch (_: Exception) {
            null
        }
    }

    private fun fetchRouteMap(code: String): Map<String, String> {
        val map = mutableMapOf<String, String>()
        try {
            val url = "https://telematics.oasa.gr/api/?act=webRoutesForStop&p1=$code"
            val req = Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android Wear OS; BusTop)")
                .build()
            val response = httpClient.newCall(req).execute()
            val body = response.body?.string() ?: ""
            if (body.isNotEmpty() && body != "null") {
                val json = JSONArray(body)
                for (i in 0 until json.length()) {
                    val obj = json.getJSONObject(i)
                    val rCode = obj.optString("RouteCode")
                    val lId = obj.optString("LineID")
                    if (rCode.isNotEmpty() && lId.isNotEmpty()) {
                        map[rCode] = lId
                    }
                }
            }
        } catch (_: Exception) {}
        return map
    }

    private fun buildTileLayout(arrivals: List<WatchArrival>): LayoutElementBuilders.Layout {
        val root = LayoutElementBuilders.Column.Builder()
            .setWidth(DimensionBuilders.wrap())
            .setHeight(DimensionBuilders.wrap())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)

        val clickAction = ActionBuilders.LaunchAction.Builder()
            .setAndroidActivity(
                ActionBuilders.AndroidActivity.Builder()
                    .setPackageName(packageName)
                    .setClassName("com.oasa.athensbus.wear.MainActivity")
                    .build()
            )
            .build()

        if (arrivals.isEmpty()) {
            // Clean Empty State: No pinned arrivals
            root.addContent(
                LayoutElementBuilders.Text.Builder()
                    .setText("📌 BusTop")
                    .setFontStyle(
                        LayoutElementBuilders.FontStyle.Builder()
                            .setSize(sp(14f))
                            .setColor(argb(0xFFCBD5E1.toInt()))
                            .setWeight(FONT_WEIGHT_BOLD)
                            .build()
                    )
                    .build()
            )

            root.addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(6f)).build())

            val emptyBox = LayoutElementBuilders.Box.Builder()
                .setModifiers(
                    ModifiersBuilders.Modifiers.Builder()
                        .setBackground(
                            ModifiersBuilders.Background.Builder()
                                .setColor(argb(0xFFFFFFFF.toInt()))
                                .setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(12f)).build())
                                .build()
                        )
                        .setPadding(
                            ModifiersBuilders.Padding.Builder()
                                .setStart(dp(10f))
                                .setEnd(dp(10f))
                                .setTop(dp(8f))
                                .setBottom(dp(8f))
                                .build()
                        )
                        .build()
                )
                .addContent(
                    LayoutElementBuilders.Text.Builder()
                        .setText("Δεν υπάρχουν\nκαρφιτσωμένες αφίξεις")
                        .setFontStyle(
                            LayoutElementBuilders.FontStyle.Builder()
                                .setSize(sp(11f))
                                .setColor(argb(0xFF0F172A.toInt()))
                                .setWeight(FONT_WEIGHT_BOLD)
                                .build()
                        )
                        .setMaxLines(2)
                        .build()
                )
                .build()

            root.addContent(emptyBox)
            root.addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(8f)).build())

            val openBtn = LayoutElementBuilders.Box.Builder()
                .setModifiers(
                    ModifiersBuilders.Modifiers.Builder()
                        .setClickable(
                            ModifiersBuilders.Clickable.Builder()
                                .setId("open_app_empty")
                                .setOnClick(clickAction)
                                .build()
                        )
                        .setBackground(
                            ModifiersBuilders.Background.Builder()
                                .setColor(argb(0xFF005AC1.toInt()))
                                .setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(9999f)).build())
                                .build()
                        )
                        .setPadding(
                            ModifiersBuilders.Padding.Builder()
                                .setStart(dp(12f))
                                .setEnd(dp(12f))
                                .setTop(dp(4f))
                                .setBottom(dp(4f))
                                .build()
                        )
                        .build()
                )
                .addContent(
                    LayoutElementBuilders.Text.Builder()
                        .setText("🚍 Άνοιγμα BusTop")
                        .setFontStyle(
                            LayoutElementBuilders.FontStyle.Builder()
                                .setSize(sp(11f))
                                .setWeight(FONT_WEIGHT_BOLD)
                                .setColor(argb(0xFFFFFFFF.toInt()))
                                .build()
                        )
                        .build()
                )
                .build()

            root.addContent(openBtn)
            return LayoutElementBuilders.Layout.Builder().setRoot(root.build()).build()
        }

        // Pinned Arrivals Present
        root.addContent(
            LayoutElementBuilders.Text.Builder()
                .setText("📌 Καρφιτσωμένες (${arrivals.size})")
                .setFontStyle(
                    LayoutElementBuilders.FontStyle.Builder()
                        .setSize(sp(12f))
                        .setColor(argb(0xFFE2E8F0.toInt()))
                        .setWeight(FONT_WEIGHT_BOLD)
                        .build()
                )
                .setMaxLines(1)
                .build()
        )

        root.addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(4f)).build())

        // Render up to 2-3 arrivals in compact rows
        val cardList = LayoutElementBuilders.Column.Builder()
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)

        arrivals.take(2).forEachIndexed { index, arr ->
            if (index > 0) {
                cardList.addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(3f)).build())
            }

            val row = LayoutElementBuilders.Row.Builder()
                .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)

            // Line Badge
            val badge = LayoutElementBuilders.Box.Builder()
                .setModifiers(
                    ModifiersBuilders.Modifiers.Builder()
                        .setBackground(
                            ModifiersBuilders.Background.Builder()
                                .setColor(argb(0xFFD8E2FF.toInt()))
                                .setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(6f)).build())
                                .build()
                        )
                        .setPadding(
                            ModifiersBuilders.Padding.Builder()
                                .setStart(dp(6f))
                                .setEnd(dp(6f))
                                .setTop(dp(2f))
                                .setBottom(dp(2f))
                                .build()
                        )
                        .build()
                )
                .addContent(
                    LayoutElementBuilders.Text.Builder()
                        .setText(arr.routeId)
                        .setFontStyle(
                            LayoutElementBuilders.FontStyle.Builder()
                                .setSize(sp(13f))
                                .setWeight(FONT_WEIGHT_BOLD)
                                .setColor(argb(0xFF001A41.toInt()))
                                .build()
                        )
                        .build()
                )
                .build()

            row.addContent(badge)
            row.addContent(LayoutElementBuilders.Spacer.Builder().setWidth(dp(6f)).build())

            // Stop Name
            row.addContent(
                LayoutElementBuilders.Text.Builder()
                    .setText(arr.stopName)
                    .setFontStyle(
                        LayoutElementBuilders.FontStyle.Builder()
                            .setSize(sp(11f))
                            .setWeight(FONT_WEIGHT_BOLD)
                            .setColor(argb(0xFF0F172A.toInt()))
                            .build()
                    )
                    .setMaxLines(1)
                    .build()
            )

            row.addContent(LayoutElementBuilders.Spacer.Builder().setWidth(dp(6f)).build())

            // Time
            val minsText = if (arr.minsRemaining == 0) "Τώρα" else "${arr.minsRemaining}'"
            row.addContent(
                LayoutElementBuilders.Text.Builder()
                    .setText(minsText)
                    .setFontStyle(
                        LayoutElementBuilders.FontStyle.Builder()
                            .setSize(sp(14f))
                            .setWeight(FONT_WEIGHT_BOLD)
                            .setColor(argb(0xFF10B981.toInt()))
                            .build()
                    )
                    .build()
            )

            val rowCard = LayoutElementBuilders.Box.Builder()
                .setModifiers(
                    ModifiersBuilders.Modifiers.Builder()
                        .setBackground(
                            ModifiersBuilders.Background.Builder()
                                .setColor(argb(0xFFFFFFFF.toInt()))
                                .setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(10f)).build())
                                .build()
                        )
                        .setPadding(
                            ModifiersBuilders.Padding.Builder()
                                .setStart(dp(8f))
                                .setEnd(dp(8f))
                                .setTop(dp(4f))
                                .setBottom(dp(4f))
                                .build()
                        )
                        .build()
                )
                .addContent(row.build())
                .build()

            cardList.addContent(rowCard)
        }

        root.addContent(cardList.build())
        root.addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(6f)).build())

        // Open BusTop button
        val openBtn = LayoutElementBuilders.Box.Builder()
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setClickable(
                        ModifiersBuilders.Clickable.Builder()
                            .setId("open_app_pinned")
                            .setOnClick(clickAction)
                            .build()
                    )
                    .setBackground(
                        ModifiersBuilders.Background.Builder()
                            .setColor(argb(0xFF005AC1.toInt()))
                            .setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(9999f)).build())
                            .build()
                    )
                    .setPadding(
                        ModifiersBuilders.Padding.Builder()
                            .setStart(dp(12f))
                            .setEnd(dp(12f))
                            .setTop(dp(4f))
                            .setBottom(dp(4f))
                            .build()
                    )
                    .build()
            )
            .addContent(
                LayoutElementBuilders.Text.Builder()
                    .setText("🚍 BusTop")
                    .setFontStyle(
                        LayoutElementBuilders.FontStyle.Builder()
                            .setSize(sp(11f))
                            .setWeight(FONT_WEIGHT_BOLD)
                            .setColor(argb(0xFFFFFFFF.toInt()))
                            .build()
                    )
                    .build()
            )
            .build()

        root.addContent(openBtn)

        return LayoutElementBuilders.Layout.Builder().setRoot(root.build()).build()
    }

    data class WatchArrival(
        val stopName: String,
        val routeId: String,
        val minsRemaining: Int,
        val destination: String
    )
}
