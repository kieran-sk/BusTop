package com.oasa.athensbus.wear

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.wear.compose.foundation.lazy.AutoCenteringParams
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyColumnDefaults
import androidx.wear.compose.foundation.lazy.ScalingLazyListState
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.*
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .build()

    private val routeCodeCache = ConcurrentHashMap<String, String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            WearBusTopApp(
                onFetchNearbyStops = { fetchNearbyStopsList() },
                onFetchArrivals = { code -> queryStopArrivals(code) },
                onNavigateToStop = { lat, lng, name -> navigateToStop(lat, lng, name) },
                onTogglePin = { stop, lineId, mins -> togglePin(stop, lineId, mins) },
                onLoadPins = { loadPinnedItems() }
            )
        }
    }

    private fun navigateToStop(lat: Double, lng: Double, name: String) {
        try {
            val uri = Uri.parse("geo:$lat,$lng?q=$lat,$lng(${Uri.encode(name)})")
            val mapIntent = Intent(Intent.ACTION_VIEW, uri)
            mapIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            startActivity(mapIntent)
        } catch (_: Exception) {
            try {
                val webUri = Uri.parse("https://www.google.com/maps/dir/?api=1&destination=$lat,$lng")
                val webIntent = Intent(Intent.ACTION_VIEW, webUri)
                webIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                startActivity(webIntent)
            } catch (_: Exception) {}
        }
    }

    @SuppressLint("MissingPermission")
    private fun getLastKnownLocation(): Pair<Double, Double> {
        val hasFine = ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val hasCoarse = ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        if (hasFine || hasCoarse) {
            val locManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            if (locManager != null) {
                val providers = listOf(
                    LocationManager.GPS_PROVIDER,
                    LocationManager.NETWORK_PROVIDER,
                    LocationManager.PASSIVE_PROVIDER
                )
                for (p in providers) {
                    try {
                        val loc: Location? = locManager.getLastKnownLocation(p)
                        if (loc != null) return Pair(loc.latitude, loc.longitude)
                    } catch (_: Exception) {}
                }
            }
        }
        return Pair(37.9845, 23.7335)
    }

    private fun loadStoredFavorites(): List<WearStopItem> {
        val favs = mutableListOf<WearStopItem>()
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
                        val lat = if (obj.has("lat") && !obj.isNull("lat")) obj.optDouble("lat", 0.0) else if (obj.has("StopLat")) obj.optDouble("StopLat", 0.0) else 0.0
                        val lng = if (obj.has("lng") && !obj.isNull("lng")) obj.optDouble("lng", 0.0) else if (obj.has("StopLng")) obj.optDouble("StopLng", 0.0) else 0.0
                        if (code.isNotEmpty() && favs.none { it.code == code }) {
                            favs.add(WearStopItem(code = code, name = name, lat = lat, lng = lng, isFavorite = true))
                        }
                    }
                } catch (_: Exception) {}
            }
        }
        return favs
    }

    private fun loadPinnedItems(): List<PinnedItem> {
        val list = mutableListOf<PinnedItem>()
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
                            list.add(PinnedItem(stopCode = stopCode, stopName = stopName, lineId = lineId))
                        }
                    }
                } catch (_: Exception) {}
            }
        }
        return list
    }

    private fun togglePin(stop: WearStopItem, lineId: String, currentMinutes: Int): Boolean {
        val currentPins = loadPinnedItems().toMutableList()
        val exists = currentPins.any { it.stopCode == stop.code && it.lineId.equals(lineId, ignoreCase = true) }
        val prefs = getSharedPreferences("BusTopWatch", Context.MODE_PRIVATE)

        if (exists) {
            currentPins.removeAll { it.stopCode == stop.code && it.lineId.equals(lineId, ignoreCase = true) }
        } else {
            currentPins.add(PinnedItem(stopCode = stop.code, stopName = stop.name, lineId = lineId))
        }

        val jsonArr = JSONArray()
        currentPins.forEach { pin ->
            val obj = JSONObject()
            obj.put("stopCode", pin.stopCode)
            obj.put("stopName", pin.stopName)
            obj.put("lineId", pin.lineId)
            jsonArr.put(obj)
        }
        prefs.edit().putString("pinned_trips", jsonArr.toString()).apply()

        // Sync with primary preferences if available
        try {
            getSharedPreferences("OASA_PERSISTENT_DATA", Context.MODE_PRIVATE)
                .edit()
                .putString("OASA_PINNED_ARRIVALS", jsonArr.toString())
                .apply()
        } catch (_: Exception) {}

        return !exists
    }

    private suspend fun fetchNearbyStopsList(): List<WearStopItem> = withContext(Dispatchers.IO) {
        val (lat, lng) = getLastKnownLocation()
        val list = mutableListOf<WearStopItem>()
        val favs = loadStoredFavorites()

        // Calculate distance for favourites
        favs.forEach { fav ->
            var dist = 0
            if (fav.lat != 0.0 && fav.lng != 0.0) {
                val results = FloatArray(1)
                Location.distanceBetween(lat, lng, fav.lat, fav.lng, results)
                dist = results[0].toInt()
            }
            list.add(fav.copy(distanceMeters = dist))
        }

        try {
            val url = "https://telematics.oasa.gr/api/?act=getClosestStops&p1=$lat&p2=$lng"
            val req = Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android Wear OS; BusTop)")
                .build()
            val resp = httpClient.newCall(req).execute()
            val body = resp.body?.string() ?: ""
            if (body.isNotEmpty() && body != "null") {
                val arr = JSONArray(body)
                for (i in 0 until minOf(arr.length(), 25)) {
                    val obj = arr.getJSONObject(i)
                    val sCode = obj.optString("StopCode")
                    val sName = obj.optString("StopDescr", "Στάση $sCode")
                    val sLat = obj.optDouble("StopLat", 0.0)
                    val sLng = obj.optDouble("StopLng", 0.0)
                    var dist = 0
                    if (sLat != 0.0 && sLng != 0.0) {
                        val results = FloatArray(1)
                        Location.distanceBetween(lat, lng, sLat, sLng, results)
                        dist = results[0].toInt()
                    }
                    if (sCode.isNotEmpty() && list.none { it.code == sCode }) {
                        list.add(WearStopItem(code = sCode, name = sName, lat = sLat, lng = sLng, distanceMeters = dist))
                    }
                }
            }
        } catch (_: Exception) {}

        if (list.isEmpty()) {
            list.add(WearStopItem("10175", "Πλ. Κάνιγγος", 37.9856, 23.7314, 85))
            list.add(WearStopItem("60010", "Ναυαρίνου", 37.9840, 23.7345, 160))
            list.add(WearStopItem("10022", "Πλ. Συντάγματος", 37.9754, 23.7350, 280))
            list.add(WearStopItem("10034", "Ακαδημία", 37.9801, 23.7330, 320))
            list.add(WearStopItem("10018", "Ομόνοια", 37.9841, 23.7280, 410))
        }

        // Sort: Favorites first, then nearest
        list.sortedWith(compareByDescending<WearStopItem> { it.isFavorite }.thenBy { it.distanceMeters })
    }

    suspend fun queryStopArrivals(stopCode: String): List<ArrivalItem> = withContext(Dispatchers.IO) {
        val list = mutableListOf<ArrivalItem>()
        try {
            ensureRouteMap(stopCode)
            val url = "https://telematics.oasa.gr/api/?act=getStopArrivals&p1=$stopCode"
            val req = Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android Wear OS; BusTop)")
                .build()
            val resp = httpClient.newCall(req).execute()
            val body = resp.body?.string() ?: ""
            if (body.isNotEmpty() && body != "null") {
                val json = JSONArray(body)
                for (i in 0 until json.length()) {
                    val item = json.getJSONObject(i)
                    val btime = item.optInt("btime2", -1)
                    val mins = if (btime >= 0) btime else item.optString("btime2").toIntOrNull() ?: 0
                    val routeCode = item.optString("route_code")
                    val lineId = routeCodeCache[routeCode] ?: routeCode.ifEmpty { "BUS" }
                    list.add(ArrivalItem(line = lineId, minutes = mins))
                }
            }
        } catch (_: Exception) {}
        list.sortedBy { it.minutes }
    }

    private fun ensureRouteMap(stopCode: String) {
        try {
            val url = "https://telematics.oasa.gr/api/?act=webRoutesForStop&p1=$stopCode"
            val req = Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android Wear OS; BusTop)")
                .build()
            val resp = httpClient.newCall(req).execute()
            val body = resp.body?.string() ?: ""
            if (body.isNotEmpty() && body != "null") {
                val arr = JSONArray(body)
                for (i in 0 until arr.length()) {
                    val obj = arr.getJSONObject(i)
                    val rCode = obj.optString("RouteCode")
                    val lId = obj.optString("LineID")
                    if (rCode.isNotEmpty() && lId.isNotEmpty()) routeCodeCache[rCode] = lId
                }
            }
        } catch (_: Exception) {}
    }
}

// ─── Data models ──────────────────────────────────────────────────────────────

data class WearStopItem(
    val code: String,
    val name: String,
    val lat: Double = 0.0,
    val lng: Double = 0.0,
    val distanceMeters: Int = 0,
    val isFavorite: Boolean = false
)

data class ArrivalItem(
    val line: String,
    val minutes: Int
)

data class PinnedItem(
    val stopCode: String,
    val stopName: String,
    val lineId: String
)

// ─── Clean Expressive Theme Palette (Matching Phone App Exactly) ──────────────

private val PhoneSurfaceBg      = Color(0xFFF8FAFC) // Crisp M3 Slate Canvas
private val PhoneCardBg         = Color(0xFFFFFFFF) // Pure 100% Solid Card
private val PhonePrimaryBlue    = Color(0xFF005AC1) // Clean Primary Blue
private val PhonePrimaryPill    = Color(0xFFD8E2FF) // Clean Light Blue Pill
private val PhonePrimaryText    = Color(0xFF001A41) // High contrast Deep Blue
private val PhoneTextPrimary    = Color(0xFF0F172A) // Bold dark slate on cards
private val PhoneTextMuted      = Color(0xFF64748B) // Subtle secondary text
private val PhoneBorderSubtle   = Color(0xFFE2E8F0) // Crisp card outline
private val PhoneLiveGreen      = Color(0xFF10B981) // Phosphor Emerald
private val PhoneGreenContainer = Color(0xFFECFDF5) // Green subtle pill
private val PhoneGreenText      = Color(0xFF065F46) // Deep Green text
private val PhoneAmber          = Color(0xFFF59E0B) // Favorite / Pin Gold
private val PhoneAmberContainer = Color(0xFFFFFBEB) // Amber subtle container
private val PhoneAmberText      = Color(0xFF92400E) // Deep Amber text

// ─── Root app composable ──────────────────────────────────────────────────────

@Composable
fun WearBusTopApp(
    onFetchNearbyStops: suspend () -> List<WearStopItem>,
    onFetchArrivals: suspend (String) -> List<ArrivalItem>,
    onNavigateToStop: (Double, Double, String) -> Unit,
    onTogglePin: (WearStopItem, String, Int) -> Boolean,
    onLoadPins: () -> List<PinnedItem>
) {
    val arrivalsMap = remember { mutableStateMapOf<String, List<ArrivalItem>>() }
    var stops by remember { mutableStateOf<List<WearStopItem>>(emptyList()) }
    var pinnedList by remember { mutableStateOf<List<PinnedItem>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var selectedStop by remember { mutableStateOf<WearStopItem?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun loadAll() {
        isLoading = true
        pinnedList = onLoadPins()
        val fetched = onFetchNearbyStops()
        stops = fetched
        isLoading = false
        fetched.forEach { stop ->
            scope.launch {
                arrivalsMap[stop.code] = onFetchArrivals(stop.code)
            }
        }
    }

    // Initial load: Starts immediately with nearby stops
    LaunchedEffect(Unit) {
        loadAll()
    }

    // Auto-refresh arrivals every 30s
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            stops.forEach { stop ->
                scope.launch {
                    arrivalsMap[stop.code] = onFetchArrivals(stop.code)
                }
            }
        }
    }

    if (selectedStop != null) {
        ArrivalsScreen(
            stop = selectedStop!!,
            arrivals = arrivalsMap[selectedStop!!.code],
            pinnedList = pinnedList,
            onBack = { selectedStop = null },
            onRefresh = {
                scope.launch {
                    arrivalsMap[selectedStop!!.code] = onFetchArrivals(selectedStop!!.code)
                }
            },
            onNavigate = {
                onNavigateToStop(selectedStop!!.lat, selectedStop!!.lng, selectedStop!!.name)
            },
            onTogglePin = { line, mins ->
                onTogglePin(selectedStop!!, line, mins)
                pinnedList = onLoadPins()
            }
        )
    } else {
        NearbyStopsListScreen(
            stops = stops,
            arrivalsMap = arrivalsMap,
            pinnedList = pinnedList,
            isLoading = isLoading,
            onStopTap = { stop -> selectedStop = stop },
            onRefresh = { scope.launch { loadAll() } }
        )
    }
}

// ─── Nearby Stops Feed (Immediate default screen with Crown Scrolling) ───────

@Composable
fun NearbyStopsListScreen(
    stops: List<WearStopItem>,
    arrivalsMap: Map<String, List<ArrivalItem>>,
    pinnedList: List<PinnedItem>,
    isLoading: Boolean,
    onStopTap: (WearStopItem) -> Unit,
    onRefresh: () -> Unit
) {
    if (isLoading) { LoadingScreen(); return }
    if (stops.isEmpty()) { EmptyScreen(onRefresh); return }

    val listState = rememberScalingLazyListState(initialCenterItemIndex = 0)
    val focusRequester = remember { FocusRequester() }
    val coroutineScope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
    }

    Scaffold(
        timeText = {
            TimeText(
                modifier = Modifier.fillMaxWidth(),
                timeTextStyle = TimeTextDefaults.timeTextStyle(fontSize = 10.sp, color = PhoneTextMuted)
            )
        },
        positionIndicator = { PositionIndicator(scalingLazyListState = listState) }
    ) {
        ScalingLazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .background(PhoneSurfaceBg)
                .onRotaryScrollEvent {
                    coroutineScope.launch {
                        listState.scrollBy(it.verticalScrollPixels)
                    }
                    true
                }
                .focusRequester(focusRequester)
                .focusable(),
            state = listState,
            autoCentering = AutoCenteringParams(itemIndex = 0),
            contentPadding = PaddingValues(horizontal = 6.dp, vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            scalingParams = ScalingLazyColumnDefaults.scalingParams(
                edgeScale = 0.88f,
                edgeAlpha = 0.65f,
                minTransitionArea = 0.2f,
                maxTransitionArea = 0.6f
            )
        ) {
            // Header Bar
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth(0.92f)
                        .padding(bottom = 6.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "📍",
                            fontSize = 11.sp,
                            modifier = Modifier.padding(end = 4.dp)
                        )
                        Text(
                            text = "Κοντινές Στάσεις",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = PhonePrimaryBlue
                        )
                    }
                    if (pinnedList.isNotEmpty()) {
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(PhoneAmberContainer)
                                .padding(horizontal = 5.dp, vertical = 1.dp)
                        ) {
                            Text(
                                text = "📌 ${pinnedList.size}",
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                color = PhoneAmberText
                            )
                        }
                    }
                }
            }

            // Cards Feed
            items(stops) { stop ->
                CleanStopCard(
                    stop = stop,
                    arrivals = arrivalsMap[stop.code],
                    isPinned = pinnedList.any { it.stopCode == stop.code },
                    onClick = { onStopTap(stop) }
                )
                Spacer(modifier = Modifier.height(6.dp))
            }

            // Refresh chip at the bottom
            item {
                Spacer(modifier = Modifier.height(4.dp))
                CompactChip(
                    onClick = onRefresh,
                    label = { Text("Ανανέωση 🔄", fontSize = 11.sp, color = PhoneTextPrimary, fontWeight = FontWeight.Bold) },
                    colors = ChipDefaults.chipColors(backgroundColor = PhoneCardBg),
                    modifier = Modifier.padding(bottom = 20.dp)
                )
            }
        }
    }
}

// ─── Clean Phone-Style Stop Card (Solid White, high-contrast, blue badge) ────

@Composable
fun CleanStopCard(
    stop: WearStopItem,
    arrivals: List<ArrivalItem>?,
    isPinned: Boolean,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxWidth(0.94f)
            .clip(RoundedCornerShape(14.dp))
            .background(PhoneCardBg)
            .clickable { onClick() }
            .padding(horizontal = 10.dp, vertical = 9.dp)
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            // Stop title row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    modifier = Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (stop.isFavorite) {
                        Text(text = "⭐ ", fontSize = 10.sp)
                    } else if (isPinned) {
                        Text(text = "📌 ", fontSize = 10.sp)
                    }
                    Text(
                        text = stop.name,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = PhoneTextPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                if (stop.distanceMeters > 0) {
                    Text(
                        text = "${stop.distanceMeters}μ",
                        fontSize = 9.sp,
                        color = PhoneTextMuted,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(start = 4.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(6.dp))

            // Arrivals preview rows
            when {
                arrivals == null -> {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(28.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            indicatorColor = PhonePrimaryBlue,
                            strokeWidth = 2.dp
                        )
                    }
                }
                arrivals.isEmpty() -> {
                    Text(
                        text = "Χωρίς άμεσα δρομολόγια",
                        fontSize = 10.sp,
                        color = PhoneTextMuted,
                        textAlign = TextAlign.Start
                    )
                }
                else -> {
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        arrivals.take(2).forEach { arr ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(PhoneSurfaceBg)
                                    .padding(horizontal = 6.dp, vertical = 2.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                // Route badge
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(4.dp))
                                        .background(PhonePrimaryPill)
                                        .padding(horizontal = 5.dp, vertical = 1.dp)
                                ) {
                                    Text(
                                        text = arr.line,
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.ExtraBold,
                                        color = PhonePrimaryText
                                    )
                                }

                                // Minutes remaining
                                Text(
                                    text = if (arr.minutes == 0) "Τώρα" else "${arr.minutes}'",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Black,
                                    color = if (arr.minutes <= 3) PhoneLiveGreen else PhonePrimaryBlue
                                )
                            }
                        }

                        if (arrivals.size > 2) {
                            Text(
                                text = "+${arrivals.size - 2} ακόμη →",
                                fontSize = 9.sp,
                                color = PhoneTextMuted,
                                textAlign = TextAlign.End,
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                    }
                }
            }
        }
    }
}

// ─── Stop Detail / Arrivals Screen with Crown Scroll & Pinning ────────────────

@Composable
fun ArrivalsScreen(
    stop: WearStopItem,
    arrivals: List<ArrivalItem>?,
    pinnedList: List<PinnedItem>,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onNavigate: () -> Unit,
    onTogglePin: (String, Int) -> Unit
) {
    val listState = rememberScalingLazyListState(initialCenterItemIndex = 0)
    val focusRequester = remember { FocusRequester() }
    val coroutineScope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
    }

    Scaffold(
        timeText = {
            TimeText(
                modifier = Modifier.fillMaxWidth(),
                timeTextStyle = TimeTextDefaults.timeTextStyle(fontSize = 10.sp, color = PhoneTextMuted)
            )
        },
        positionIndicator = { PositionIndicator(scalingLazyListState = listState) }
    ) {
        ScalingLazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .background(PhoneSurfaceBg)
                .onRotaryScrollEvent {
                    coroutineScope.launch {
                        listState.scrollBy(it.verticalScrollPixels)
                    }
                    true
                }
                .focusRequester(focusRequester)
                .focusable(),
            state = listState,
            autoCentering = AutoCenteringParams(itemIndex = 0),
            contentPadding = PaddingValues(horizontal = 6.dp, vertical = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Header Bar: Stop Name & Quick Back
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth(0.94f)
                        .padding(bottom = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = stop.name,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = PhoneTextPrimary,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = "Αφίξεις • ${stop.code}",
                        fontSize = 10.sp,
                        color = PhonePrimaryBlue,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            when {
                arrivals == null -> {
                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(70.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(22.dp),
                                indicatorColor = PhonePrimaryBlue,
                                strokeWidth = 2.5.dp
                            )
                        }
                    }
                }
                arrivals.isEmpty() -> {
                    item {
                        Text(
                            text = "Δεν υπάρχουν\nπρογραμματισμένες αφίξεις",
                            fontSize = 11.sp,
                            color = PhoneTextMuted,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(16.dp),
                            lineHeight = 16.sp
                        )
                    }
                }
                else -> {
                    items(arrivals) { arr ->
                        val isThisPinned = pinnedList.any { it.stopCode == stop.code && it.lineId.equals(arr.line, ignoreCase = true) }

                        Row(
                            modifier = Modifier
                                .fillMaxWidth(0.94f)
                                .padding(vertical = 2.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(PhoneCardBg)
                                .padding(horizontal = 8.dp, vertical = 6.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            // Left: Badge + Line
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(PhonePrimaryPill)
                                        .padding(horizontal = 6.dp, vertical = 2.dp)
                                ) {
                                    Text(
                                        text = arr.line,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.ExtraBold,
                                        color = PhonePrimaryText
                                    )
                                }
                            }

                            // Right: Time + Pin Button
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = if (arr.minutes == 0) "Τώρα" else "${arr.minutes}'",
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Black,
                                    color = if (arr.minutes <= 3) PhoneLiveGreen else PhonePrimaryBlue,
                                    modifier = Modifier.padding(end = 6.dp)
                                )

                                // Pin toggle button
                                Box(
                                    modifier = Modifier
                                        .size(24.dp)
                                        .clip(CircleShape)
                                        .background(if (isThisPinned) PhoneAmberContainer else PhoneSurfaceBg)
                                        .clickable { onTogglePin(arr.line, arr.minutes) },
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = "📌",
                                        fontSize = 10.sp
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // Quick Actions: Google Maps Navigation, Back, and Refresh
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Column(
                    modifier = Modifier.padding(bottom = 20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    // Direct Walking Navigation
                    CompactChip(
                        onClick = onNavigate,
                        label = {
                            Text(
                                "🧭 Πλοήγηση στη στάση",
                                fontSize = 11.sp,
                                color = Color.White,
                                fontWeight = FontWeight.Bold
                            )
                        },
                        colors = ChipDefaults.chipColors(backgroundColor = PhonePrimaryBlue),
                        modifier = Modifier.fillMaxWidth(0.9f)
                    )

                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // Minimal Circular Back Button (Same as Phone App)
                        Box(
                            modifier = Modifier
                                .size(34.dp)
                                .clip(CircleShape)
                                .background(PhoneCardBg)
                                .clickable { onBack() },
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "←",
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold,
                                color = PhoneTextPrimary
                            )
                        }

                        // Refresh button
                        Box(
                            modifier = Modifier
                                .size(34.dp)
                                .clip(CircleShape)
                                .background(PhoneCardBg)
                                .clickable { onRefresh() },
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "🔄",
                                fontSize = 13.sp
                            )
                        }
                    }
                }
            }
        }
    }
}

// ─── Loading / Empty screens ──────────────────────────────────────────────────

@Composable
fun LoadingScreen() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(PhoneSurfaceBg),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(modifier = Modifier.size(28.dp), indicatorColor = PhonePrimaryBlue)
            Spacer(modifier = Modifier.height(10.dp))
            Text(text = "Φόρτωση στάσεων…", fontSize = 11.sp, color = PhoneTextMuted, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
fun EmptyScreen(onRefresh: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(PhoneSurfaceBg),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = "Δεν βρέθηκαν κοντινές στάσεις",
                fontSize = 11.sp,
                color = PhoneTextMuted,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(10.dp))
            CompactChip(
                onClick = onRefresh,
                label = { Text("Ανανέωση 🔄", fontSize = 11.sp, color = PhoneTextPrimary, fontWeight = FontWeight.Bold) },
                colors = ChipDefaults.chipColors(backgroundColor = PhoneCardBg)
            )
        }
    }
}


