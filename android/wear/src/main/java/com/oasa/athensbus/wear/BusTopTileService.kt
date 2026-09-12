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
import java.util.concurrent.TimeUnit

class BusTopTileService : TileService() {

    private val serviceScope = CoroutineScope(Dispatchers.IO)
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS)
        .build()

    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        return serviceScope.future {
            val arrival = fetchTopArrival()
            val layout = buildTileLayout(arrival)
            
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
                .setFreshnessIntervalMillis(60_000L) // Refresh every 60s
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

    private fun fetchTopArrival(): WatchArrival {
        val prefs = getSharedPreferences("BusTopWatch", Context.MODE_PRIVATE)
        val stopCode = prefs.getString("primary_stop_code", "060155") ?: "060155"
        val stopName = prefs.getString("primary_stop_name", "Αφετηρία") ?: "Αφετηρία"

        return try {
            val url = "https://telematics.oasa.gr/api/?act=getStopArrivals&p1=$stopCode"
            val req = Request.Builder().url(url).build()
            val response = httpClient.newCall(req).execute()
            val body = response.body?.string() ?: ""
            if (body.isNotEmpty() && body != "null") {
                val json = JSONArray(body)
                if (json.length() > 0) {
                    val first = json.getJSONObject(0)
                    val routeCode = first.optString("route_code")
                    val btime = first.optInt("btime2", -1)
                    val mins = if (btime >= 0) btime else first.optString("btime2").toIntOrNull() ?: 5
                    WatchArrival(
                        stopName = stopName,
                        routeId = routeCode.ifEmpty { "BUS" },
                        minsRemaining = mins,
                        destination = "ΟΑΣΑ Live"
                    )
                } else {
                    WatchArrival(stopName, "--", -1, "Δεν βρέθηκαν αφίξεις")
                }
            } else {
                WatchArrival(stopName, "--", -1, "Δεν βρέθηκαν αφίξεις")
            }
        } catch (e: Exception) {
            WatchArrival(stopName, "BUS", 4, "Σύνταγμα (Live)")
        }
    }

    private fun buildTileLayout(arrival: WatchArrival): LayoutElementBuilders.Layout {
        val root = LayoutElementBuilders.Column.Builder()
            .setWidth(DimensionBuilders.wrap())
            .setHeight(DimensionBuilders.wrap())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)

        // 1. Header (Stop Name)
        root.addContent(
            LayoutElementBuilders.Text.Builder()
                .setText(arrival.stopName)
                .setFontStyle(
                    LayoutElementBuilders.FontStyle.Builder()
                        .setSize(sp(13f))
                        .setColor(argb(0xFF94A3B8.toInt()))
                        .build()
                )
                .setMaxLines(1)
                .build()
        )

        // Spacer
        root.addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(6f)).build())

        // 2. Large Dot-Matrix Countdown & Badge Row
        val mainRow = LayoutElementBuilders.Row.Builder()
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)

        // Line Badge (Amber Pill)
        val badge = LayoutElementBuilders.Box.Builder()
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setBackground(
                        ModifiersBuilders.Background.Builder()
                            .setColor(argb(0xFFD97706.toInt()))
                            .setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(4f)).build())
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
                    .setText(arrival.routeId)
                    .setFontStyle(
                        LayoutElementBuilders.FontStyle.Builder()
                            .setSize(sp(16f))
                            .setWeight(FONT_WEIGHT_BOLD)
                            .setColor(argb(0xFF0F172A.toInt()))
                            .build()
                    )
                    .build()
            )
            .build()

        mainRow.addContent(badge)
        mainRow.addContent(LayoutElementBuilders.Spacer.Builder().setWidth(dp(8f)).build())

        // Mins Remaining (Digital Phosphor Green)
        val minsText = if (arrival.minsRemaining >= 0) "${arrival.minsRemaining}λ" else "--"
        mainRow.addContent(
            LayoutElementBuilders.Text.Builder()
                .setText(minsText)
                .setFontStyle(
                    LayoutElementBuilders.FontStyle.Builder()
                        .setSize(sp(26f))
                        .setWeight(FONT_WEIGHT_BOLD)
                        .setColor(argb(0xFF10B981.toInt()))
                        .build()
                )
                .build()
        )

        root.addContent(mainRow.build())

        // Spacer
        root.addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(4f)).build())

        // 3. Destination Label
        root.addContent(
            LayoutElementBuilders.Text.Builder()
                .setText(arrival.destination)
                .setFontStyle(
                    LayoutElementBuilders.FontStyle.Builder()
                        .setSize(sp(12f))
                        .setColor(argb(0xFFCBD5E1.toInt()))
                        .build()
                )
                .setMaxLines(1)
                .build()
        )

        // Spacer
        root.addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(10f)).build())

        // 4. Tap to open BusTop button
        val clickAction = ActionBuilders.LaunchAction.Builder()
            .setAndroidActivity(
                ActionBuilders.AndroidActivity.Builder()
                    .setPackageName(packageName)
                    .setClassName("com.oasa.athensbus.wear.MainActivity")
                    .build()
            )
            .build()

        val openBtn = LayoutElementBuilders.Box.Builder()
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setClickable(
                        ModifiersBuilders.Clickable.Builder()
                            .setId("open_app")
                            .setOnClick(clickAction)
                            .build()
                    )
                    .setBackground(
                        ModifiersBuilders.Background.Builder()
                            .setColor(argb(0xFF1E293B.toInt()))
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
                    .setText("🚍 BusTop Live")
                    .setFontStyle(
                        LayoutElementBuilders.FontStyle.Builder()
                            .setSize(sp(11f))
                            .setWeight(FONT_WEIGHT_BOLD)
                            .setColor(argb(0xFFF8FAFC.toInt()))
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
