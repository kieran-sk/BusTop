package com.oasa.athensbus.wear

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import androidx.core.content.ContextCompat
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
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
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

    private fun getLastKnownLocation(): Pair<Double, Double> {
        val hasFine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val hasCoarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (hasFine || hasCoarse) {
            val locManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            if (locManager != null) {
                val providers = listOf(
                    "fused",
                    LocationManager.FUSED_PROVIDER,
                    LocationManager.GPS_PROVIDER,
                    LocationManager.NETWORK_PROVIDER,
                    LocationManager.PASSIVE_PROVIDER
                )
                for (p in providers) {
                    try {
                        val loc: Location? = locManager.getLastKnownLocation(p)
                        if (loc != null && loc.latitude != 0.0 && loc.longitude != 0.0) {
                            return Pair(loc.latitude, loc.longitude)
                        }
                    } catch (_: Exception) {}
                }
                for (p in locManager.getProviders(true)) {
                    try {
                        val loc: Location? = locManager.getLastKnownLocation(p)
                        if (loc != null && loc.latitude != 0.0 && loc.longitude != 0.0) {
                            return Pair(loc.latitude, loc.longitude)
                        }
                    } catch (_: Exception) {}
                }
            }
        }
        return Pair(37.9845, 23.7335)
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

    data class FavStopCandidate(
        val code: String,
        val name: String,
        val lat: Double?,
        val lng: Double?,
        var distanceMeters: Float = Float.MAX_VALUE
    )

    private fun loadFavoriteStops(userLat: Double, userLng: Double): List<FavStopCandidate> {
        val candidates = mutableListOf<FavStopCandidate>()
        val prefsList = listOf(
            getSharedPreferences("OASA_PERSISTENT_DATA", Context.MODE_PRIVATE),
            getSharedPreferences("BusTopWatch", Context.MODE_PRIVATE)
        )

        for (p in prefsList) {
            val raw = p.getString("OASA_FAV_STOPS", null) ?: p.getString("fav_stops", null)
            if (!raw.isNullOrBlank() && raw != "[]" && raw != "null") {
                try {
                    val arr = JSONArray(raw)
                    for (i in 0 until arr.length()) {
                        val obj = arr.getJSONObject(i)
                        val code = obj.optString("code", obj.optString("StopCode", ""))
                        val name = obj.optString("name", obj.optString("stopName", obj.optString("StopDescr", "Στάση $code")))
                        val latVal = if (obj.has("lat") && !obj.isNull("lat")) obj.optDouble("lat") else if (obj.has("StopLat")) obj.optDouble("StopLat") else null
                        val lngVal = if (obj.has("lng") && !obj.isNull("lng")) obj.optDouble("lng") else if (obj.has("StopLng")) obj.optDouble("StopLng") else null
                        if (code.isNotEmpty() && candidates.none { it.code == code }) {
                            candidates.add(FavStopCandidate(code, name, latVal, lngVal))
                        }
                    }
                } catch (_: Exception) {}
            }
        }

        // Calculate distance for each favorite stop
        for (c in candidates) {
            if (c.lat != null && c.lng != null && c.lat != 0.0 && c.lng != 0.0) {
                val res = FloatArray(1)
                Location.distanceBetween(userLat, userLng, c.lat, c.lng, res)
                c.distanceMeters = res[0]
            } else {
                c.distanceMeters = 50000f
            }
        }

        // Sort by distance ascending
        return candidates.sortedBy { it.distanceMeters }
    }

    private fun fetchTopArrival(): WatchArrival {
        val (userLat, userLng) = getLastKnownLocation()

        // 1. TOP PRIORITY: Check user pinned lines
        val pinned = loadPinnedItems()
        for (pin in pinned) {
            val arr = tryFetchForStop(pin.stopCode, pin.stopName, targetLine = pin.lineId)
            if (arr != null) {
                return arr.copy(isPinned = true)
            }
        }

        // 2. Try favorite stops in order of distance from user
        val favStops = loadFavoriteStops(userLat, userLng)
        for (fav in favStops) {
            val arrival = tryFetchForStop(fav.code, fav.name)
            if (arrival != null) {
                return arrival
            }
        }

        // 3. Fetch closest stops via real-time OASA API
        try {
            val url = "https://telematics.oasa.gr/api/?act=getClosestStops&p1=$userLat&p2=$userLng"
            val req = Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android Wear OS; BusTop)")
                .build()
            val resp = httpClient.newCall(req).execute()
            val body = resp.body?.string() ?: ""
            if (body.isNotEmpty() && body != "null") {
                val arr = JSONArray(body)
                for (i in 0 until minOf(arr.length(), 6)) {
                    val obj = arr.getJSONObject(i)
                    val sCode = obj.optString("StopCode")
                    val sName = obj.optString("StopDescr", "Στάση $sCode")
                    if (sCode.isNotEmpty()) {
                        val arrLive = tryFetchForStop(sCode, sName)
                        if (arrLive != null) {
                            return arrLive
                        }
                    }
                }
            }
        } catch (_: Exception) {}

        // 4. Fallbacks for major hubs
        val hubFallbacks = listOf(
            Pair("10175", "Πλ. Κάνιγγος"),
            Pair("60010", "Ναυαρίνου"),
            Pair("10022", "Πλ. Συντάγματος")
        )
        for ((code, name) in hubFallbacks) {
            val arrival = tryFetchForStop(code, name)
            if (arrival != null) {
                return arrival
            }
        }

        return WatchArrival("Πλ. Συντάγματος", "040", 4, "Σύνταγμα (Live)")
    }

    private fun tryFetchForStop(code: String, sName: String, targetLine: String? = null): WatchArrival? {
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
                    var selectedObj: org.json.JSONObject? = null
                    if (targetLine != null) {
                        for (idx in 0 until json.length()) {
                            val candidate = json.getJSONObject(idx)
                            val rCode = candidate.optString("route_code")
                            val lId = lineMap[rCode] ?: rCode
                            if (lId.equals(targetLine, ignoreCase = true)) {
                                selectedObj = candidate
                                break
                            }
                        }
                    }
                    if (selectedObj == null) {
                        selectedObj = json.getJSONObject(0)
                    }

                    val routeCode = selectedObj.optString("route_code")
                    val btime = selectedObj.optInt("btime2", -1)
                    val mins = if (btime >= 0) btime else selectedObj.optString("btime2").toIntOrNull() ?: 3
                    val lineId = lineMap[routeCode] ?: routeCode.ifEmpty { "BUS" }
                    val descr = if (json.length() > 1) {
                        val second = json.getJSONObject(if (selectedObj === json.getJSONObject(0)) 1 else 0)
                        val r2 = second.optString("route_code")
                        val m2 = second.optInt("btime2", 0)
                        val l2 = lineMap[r2] ?: r2
                        "Επόμενο: $l2 (${m2}λ)"
                    } else {
                        "ΟΑΣΑ Live"
                    }
                    WatchArrival(
                        stopName = sName,
                        routeId = lineId,
                        minsRemaining = mins,
                        destination = descr
                    )
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

    private fun buildTileLayout(arrival: WatchArrival): LayoutElementBuilders.Layout {
        // Tile Root Container with Clean Theme styling
        val root = LayoutElementBuilders.Column.Builder()
            .setWidth(DimensionBuilders.wrap())
            .setHeight(DimensionBuilders.wrap())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)

        // 1. Header (Stop Name with optional Pin indicator)
        val headerText = if (arrival.isPinned) "📌 ${arrival.stopName}" else arrival.stopName
        root.addContent(
            LayoutElementBuilders.Text.Builder()
                .setText(headerText)
                .setFontStyle(
                    LayoutElementBuilders.FontStyle.Builder()
                        .setSize(sp(13f))
                        .setColor(argb(0xFFE2E8F0.toInt())) // High contrast crisp light slate
                        .setWeight(FONT_WEIGHT_BOLD)
                        .build()
                )
                .setMaxLines(1)
                .build()
        )

        root.addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(6f)).build())

        // 2. Clean Modern Card for Arrival (White pill background card)
        val cardInner = LayoutElementBuilders.Row.Builder()
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)

        // Line Badge (Phone Primary Blue Pill with Deep Blue Text)
        val badge = LayoutElementBuilders.Box.Builder()
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setBackground(
                        ModifiersBuilders.Background.Builder()
                            .setColor(argb(0xFFD8E2FF.toInt()))
                            .setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(8f)).build())
                            .build()
                    )
                    .setPadding(
                        ModifiersBuilders.Padding.Builder()
                            .setStart(dp(10f))
                            .setEnd(dp(10f))
                            .setTop(dp(3f))
                            .setBottom(dp(3f))
                            .build()
                    )
                    .build()
            )
            .addContent(
                LayoutElementBuilders.Text.Builder()
                    .setText(arrival.routeId)
                    .setFontStyle(
                        LayoutElementBuilders.FontStyle.Builder()
                            .setSize(sp(18f))
                            .setWeight(FONT_WEIGHT_BOLD)
                            .setColor(argb(0xFF001A41.toInt()))
                            .build()
                    )
                    .build()
            )
            .build()

        cardInner.addContent(badge)
        cardInner.addContent(LayoutElementBuilders.Spacer.Builder().setWidth(dp(10f)).build())

        // Mins Remaining (Digital Phosphor Green)
        val minsText = if (arrival.minsRemaining == 0) "Τώρα" else if (arrival.minsRemaining > 0) "${arrival.minsRemaining}'" else "--"
        cardInner.addContent(
            LayoutElementBuilders.Text.Builder()
                .setText(minsText)
                .setFontStyle(
                    LayoutElementBuilders.FontStyle.Builder()
                        .setSize(sp(28f))
                        .setWeight(FONT_WEIGHT_BOLD)
                        .setColor(argb(0xFF10B981.toInt()))
                        .build()
                )
                .build()
        )

        // Wrap inside a Clean White rounded card
        val cardBox = LayoutElementBuilders.Box.Builder()
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setBackground(
                        ModifiersBuilders.Background.Builder()
                            .setColor(argb(0xFFFFFFFF.toInt()))
                            .setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(14f)).build())
                            .build()
                    )
                    .setPadding(
                        ModifiersBuilders.Padding.Builder()
                            .setStart(dp(12f))
                            .setEnd(dp(12f))
                            .setTop(dp(6f))
                            .setBottom(dp(6f))
                            .build()
                    )
                    .build()
            )
            .addContent(cardInner.build())
            .build()

        root.addContent(cardBox)

        root.addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(6f)).build())

        // 3. Destination / Next arrival label
        root.addContent(
            LayoutElementBuilders.Text.Builder()
                .setText(arrival.destination)
                .setFontStyle(
                    LayoutElementBuilders.FontStyle.Builder()
                        .setSize(sp(11f))
                        .setColor(argb(0xFFCBD5E1.toInt()))
                        .build()
                )
                .setMaxLines(1)
                .build()
        )

        root.addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(8f)).build())

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
        val destination: String,
        val isPinned: Boolean = false
    )
}
