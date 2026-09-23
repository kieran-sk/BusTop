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
import android.view.HapticFeedbackConstants
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.scrollBy
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
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.wear.compose.foundation.lazy.AutoCenteringParams
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyColumnDefaults
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
import kotlin.math.abs

class MainActivity : ComponentActivity() {

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .build()

    private val routeCodeCache = ConcurrentHashMap<String, String>()
    private val routeDescrCache = ConcurrentHashMap<String, String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            WearBusTopApp(
                onFetchNearbyStops = { fetchNearbyStopsList() },
                onFetchArrivals = { code -> queryStopArrivals(code) },
                onTogglePin = { stop, lineId, mins -> togglePin(stop, lineId, mins) },
                onLoadPins = { loadPinnedItems() },
                onToggleFavorite = { stop -> toggleFavorite(stop) }
            )
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
                // Priority to modern fused provider on Wear OS / Android 14
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
                // Try all available providers on device
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
                        val street = obj.optString("street", obj.optString("StopStreet", ""))
                        val lat = if (obj.has("lat") && !obj.isNull("lat")) obj.optDouble("lat", 0.0) else if (obj.has("StopLat")) obj.optDouble("StopLat", 0.0) else 0.0
                        val lng = if (obj.has("lng") && !obj.isNull("lng")) obj.optDouble("lng", 0.0) else if (obj.has("StopLng")) obj.optDouble("StopLng", 0.0) else 0.0
                        if (code.isNotEmpty() && favs.none { it.code == code }) {
                            favs.add(WearStopItem(code = code, name = name, street = street, lat = lat, lng = lng, isFavorite = true))
                        }
                    }
                } catch (_: Exception) {}
            }
        }
        return favs
    }

    private fun toggleFavorite(stop: WearStopItem): Boolean {
        val currentFavs = loadStoredFavorites().toMutableList()
        val exists = currentFavs.any { it.code == stop.code }

        if (exists) {
            currentFavs.removeAll { it.code == stop.code }
        } else {
            currentFavs.add(stop.copy(isFavorite = true))
        }

        val jsonArr = JSONArray()
        currentFavs.forEach { fav ->
            val obj = JSONObject()
            obj.put("code", fav.code)
            obj.put("name", fav.name)
            obj.put("street", fav.street)
            obj.put("lat", fav.lat)
            obj.put("lng", fav.lng)
            jsonArr.put(obj)
        }

        listOf(
            getSharedPreferences("OASA_PERSISTENT_DATA", Context.MODE_PRIVATE),
            getSharedPreferences("BusTopWatch", Context.MODE_PRIVATE)
        ).forEach { prefs ->
            prefs.edit()
                .putString("OASA_FAV_STOPS", jsonArr.toString())
                .putString("fav_stops", jsonArr.toString())
                .apply()
        }

        return !exists
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
                    val sStreet = obj.optString("StopStreet", "")
                    val sLat = obj.optDouble("StopLat", 0.0)
                    val sLng = obj.optDouble("StopLng", 0.0)
                    var dist = 0
                    if (sLat != 0.0 && sLng != 0.0) {
                        val results = FloatArray(1)
                        Location.distanceBetween(lat, lng, sLat, sLng, results)
                        dist = results[0].toInt()
                    }
                    if (sCode.isNotEmpty() && list.none { it.code == sCode }) {
                        list.add(WearStopItem(code = sCode, name = sName, street = sStreet, lat = sLat, lng = sLng, distanceMeters = dist))
                    }
                }
            }
        } catch (_: Exception) {}

        if (list.isEmpty()) {
            list.add(WearStopItem("10175", "Πλ. Κάνιγγος", "Κάνιγγος", 37.9856, 23.7314, 85))
            list.add(WearStopItem("60010", "Ναυαρίνου", "Ναυαρίνου", 37.9840, 23.7345, 160))
            list.add(WearStopItem("10022", "Πλ. Συντάγματος", "Όθωνος", 37.9754, 23.7350, 280))
            list.add(WearStopItem("10034", "Ακαδημία", "Πανεπιστημίου", 37.9801, 23.7330, 320))
            list.add(WearStopItem("10018", "Ομόνοια", "Πλ. Ομονοίας", 37.9841, 23.7280, 410))
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
                    val descr = routeDescrCache[routeCode] ?: ""
                    
                    // Extract clean destination direction
                    val dest = if (descr.contains(" - ")) {
                        val parts = descr.split(" - ")
                        parts.lastOrNull()?.trim() ?: descr
                    } else descr

                    list.add(ArrivalItem(line = lineId, minutes = mins, destination = dest))
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
                    val rDescr = obj.optString("RouteDescr", "")
                    if (rCode.isNotEmpty() && lId.isNotEmpty()) {
                        routeCodeCache[rCode] = lId
                    }
                    if (rCode.isNotEmpty() && rDescr.isNotEmpty()) {
                        routeDescrCache[rCode] = rDescr
                    }
                }
            }
        } catch (_: Exception) {}
    }
}

// ─── Data models ──────────────────────────────────────────────────────────────

data class WearStopItem(
    val code: String,
    val name: String,
    val street: String = "",
    val lat: Double = 0.0,
    val lng: Double = 0.0,
    val distanceMeters: Int = 0,
    val isFavorite: Boolean = false
)

data class ArrivalItem(
    val line: String,
    val minutes: Int,
    val destination: String = ""
)

data class PinnedItem(
    val stopCode: String,
    val stopName: String,
    val lineId: String
)

enum class ScreenState {
    FEED,
    FAVORITES,
    ARRIVALS
}

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
    onTogglePin: (WearStopItem, String, Int) -> Boolean,
    onLoadPins: () -> List<PinnedItem>,
    onToggleFavorite: (WearStopItem) -> Boolean
) {
    val arrivalsMap = remember { mutableStateMapOf<String, List<ArrivalItem>>() }
    var stops by remember { mutableStateOf<List<WearStopItem>>(emptyList()) }
    var pinnedList by remember { mutableStateOf<List<PinnedItem>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var currentScreen by remember { mutableStateOf(ScreenState.FEED) }
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

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        scope.launch { loadAll() }
    }

    // Initial load: Request location permissions if needed and load stops
    LaunchedEffect(Unit) {
        permissionLauncher.launch(
            arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            )
        )
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

    fun handleToggleFavorite(stop: WearStopItem) {
        val newState = onToggleFavorite(stop)
        stops = stops.map {
            if (it.code == stop.code) it.copy(isFavorite = newState) else it
        }.sortedWith(compareByDescending<WearStopItem> { it.isFavorite }.thenBy { it.distanceMeters })
        if (selectedStop?.code == stop.code) {
            selectedStop = selectedStop?.copy(isFavorite = newState)
        }
    }

    when (currentScreen) {
        ScreenState.ARRIVALS -> {
            if (selectedStop != null) {
                ArrivalsScreen(
                    stop = selectedStop!!,
                    arrivals = arrivalsMap[selectedStop!!.code],
                    pinnedList = pinnedList,
                    onBack = {
                        selectedStop = null
                        currentScreen = ScreenState.FEED
                    },
                    onRefresh = {
                        scope.launch {
                            arrivalsMap[selectedStop!!.code] = onFetchArrivals(selectedStop!!.code)
                        }
                    },
                    onTogglePin = { line, mins ->
                        onTogglePin(selectedStop!!, line, mins)
                        pinnedList = onLoadPins()
                    },
                    onToggleFavorite = { handleToggleFavorite(selectedStop!!) }
                )
            } else {
                currentScreen = ScreenState.FEED
            }
        }
        ScreenState.FAVORITES -> {
            FavoritesListScreen(
                stops = stops.filter { it.isFavorite },
                arrivalsMap = arrivalsMap,
                pinnedList = pinnedList,
                onBack = { currentScreen = ScreenState.FEED },
                onStopTap = { stop ->
                    selectedStop = stop
                    currentScreen = ScreenState.ARRIVALS
                },
                onToggleFavorite = { stop -> handleToggleFavorite(stop) }
            )
        }
        ScreenState.FEED -> {
            NearbyStopsListScreen(
                stops = stops,
                arrivalsMap = arrivalsMap,
                pinnedList = pinnedList,
                isLoading = isLoading,
                onStopTap = { stop ->
                    selectedStop = stop
                    currentScreen = ScreenState.ARRIVALS
                },
                onOpenFavorites = { currentScreen = ScreenState.FAVORITES },
                onToggleFavorite = { stop -> handleToggleFavorite(stop) },
                onRefresh = { scope.launch { loadAll() } }
            )
        }
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
    onOpenFavorites: () -> Unit,
    onToggleFavorite: (WearStopItem) -> Unit,
    onRefresh: () -> Unit
) {
    if (isLoading) { LoadingScreen(); return }
    if (stops.isEmpty()) { EmptyScreen(onRefresh); return }

    val listState = rememberScalingLazyListState(initialCenterItemIndex = 0)
    val focusRequester = remember { FocusRequester() }
    val coroutineScope = rememberCoroutineScope()
    val view = LocalView.current
    var rotaryAccumulator by remember { mutableFloatStateOf(0f) }
    val tickThreshold = 18f

    val favCount = remember(stops) { stops.count { it.isFavorite } }

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
                    rotaryAccumulator += it.verticalScrollPixels
                    if (abs(rotaryAccumulator) >= tickThreshold) {
                        view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                        rotaryAccumulator = 0f
                    }
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
                        .fillMaxWidth(0.94f)
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
                            text = "Στάσεις",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = PhonePrimaryBlue
                        )
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        // Favorites menu button
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (favCount > 0) PhoneAmberContainer else PhoneCardBg)
                                .clickable { onOpenFavorites() }
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        ) {
                            Text(
                                text = "⭐ $favCount",
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (favCount > 0) PhoneAmberText else PhoneTextMuted
                            )
                        }

                        if (pinnedList.isNotEmpty()) {
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(PhoneAmberContainer)
                                    .padding(horizontal = 5.dp, vertical = 2.dp)
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
            }

            // Cards Feed
            items(stops) { stop ->
                CleanStopCard(
                    stop = stop,
                    arrivals = arrivalsMap[stop.code],
                    isPinned = pinnedList.any { it.stopCode == stop.code },
                    onClick = { onStopTap(stop) },
                    onLongClick = {
                        view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                        onToggleFavorite(stop)
                    }
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

// ─── Dedicated Favorites Screen ──────────────────────────────────────────────

@Composable
fun FavoritesListScreen(
    stops: List<WearStopItem>,
    arrivalsMap: Map<String, List<ArrivalItem>>,
    pinnedList: List<PinnedItem>,
    onBack: () -> Unit,
    onStopTap: (WearStopItem) -> Unit,
    onToggleFavorite: (WearStopItem) -> Unit
) {
    val listState = rememberScalingLazyListState(initialCenterItemIndex = 0)
    val focusRequester = remember { FocusRequester() }
    val coroutineScope = rememberCoroutineScope()
    val view = LocalView.current
    var rotaryAccumulator by remember { mutableFloatStateOf(0f) }
    val tickThreshold = 18f

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
                    rotaryAccumulator += it.verticalScrollPixels
                    if (abs(rotaryAccumulator) >= tickThreshold) {
                        view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                        rotaryAccumulator = 0f
                    }
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
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Header
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth(0.94f)
                        .padding(bottom = 6.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(text = "⭐", fontSize = 11.sp, modifier = Modifier.padding(end = 4.dp))
                        Text(
                            text = "Αγαπημένα",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = PhoneAmberText
                        )
                    }

                    Box(
                        modifier = Modifier
                            .size(26.dp)
                            .clip(CircleShape)
                            .background(PhoneCardBg)
                            .clickable { onBack() },
                        contentAlignment = Alignment.Center
                    ) {
                        Text(text = "←", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = PhoneTextPrimary)
                    }
                }
            }

            if (stops.isEmpty()) {
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth(0.88f)
                            .padding(vertical = 20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = "Δεν έχετε αγαπημένες στάσεις",
                            fontSize = 11.sp,
                            color = PhoneTextMuted,
                            textAlign = TextAlign.Center
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Κρατήστε πατημένη οποιαδήποτε στάση για να την προσθέσετε",
                            fontSize = 9.sp,
                            color = PhonePrimaryBlue,
                            textAlign = TextAlign.Center
                        )
                    }
                }
            } else {
                items(stops) { stop ->
                    CleanStopCard(
                        stop = stop,
                        arrivals = arrivalsMap[stop.code],
                        isPinned = pinnedList.any { it.stopCode == stop.code },
                        onClick = { onStopTap(stop) },
                        onLongClick = {
                            view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                            onToggleFavorite(stop)
                        }
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                }
            }

            item {
                Spacer(modifier = Modifier.height(8.dp))
                CompactChip(
                    onClick = onBack,
                    label = { Text("Πίσω στις στάσεις", fontSize = 11.sp, color = PhoneTextPrimary, fontWeight = FontWeight.Bold) },
                    colors = ChipDefaults.chipColors(backgroundColor = PhoneCardBg),
                    modifier = Modifier.padding(bottom = 20.dp)
                )
            }
        }
    }
}

// ─── Clean Phone-Style Stop Card (Solid White, high-contrast, blue badge) ────

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun CleanStopCard(
    stop: WearStopItem,
    arrivals: List<ArrivalItem>?,
    isPinned: Boolean,
    onClick: () -> Unit,
    onLongClick: (() -> Unit)? = null
) {
    Box(
        modifier = Modifier
            .fillMaxWidth(0.94f)
            .clip(RoundedCornerShape(14.dp))
            .background(PhoneCardBg)
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick
            )
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

            // Direction / Street subtitle if available
            if (stop.street.isNotBlank()) {
                Text(
                    text = "→ ${stop.street}",
                    fontSize = 9.sp,
                    color = PhonePrimaryBlue,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 1.dp, bottom = 4.dp)
                )
            } else {
                Spacer(modifier = Modifier.height(4.dp))
            }

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
                                // Route badge + Destination
                                Row(
                                    modifier = Modifier.weight(1f, fill = false),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
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

                                    if (arr.destination.isNotBlank()) {
                                        Text(
                                            text = " ${arr.destination}",
                                            fontSize = 9.sp,
                                            color = PhoneTextMuted,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                            modifier = Modifier.padding(start = 3.dp)
                                        )
                                    }
                                }

                                // Minutes remaining
                                Text(
                                    text = if (arr.minutes == 0) "Τώρα" else "${arr.minutes}'",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Black,
                                    color = if (arr.minutes <= 3) PhoneLiveGreen else PhonePrimaryBlue,
                                    modifier = Modifier.padding(start = 6.dp)
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
    onTogglePin: (String, Int) -> Unit,
    onToggleFavorite: () -> Unit
) {
    val listState = rememberScalingLazyListState(initialCenterItemIndex = 0)
    val focusRequester = remember { FocusRequester() }
    val coroutineScope = rememberCoroutineScope()
    val view = LocalView.current
    var rotaryAccumulator by remember { mutableFloatStateOf(0f) }
    val tickThreshold = 18f

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
                    rotaryAccumulator += it.verticalScrollPixels
                    if (abs(rotaryAccumulator) >= tickThreshold) {
                        view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                        rotaryAccumulator = 0f
                    }
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
            // Header Bar: Stop Name & Favorite Star
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth(0.94f)
                        .padding(bottom = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Text(
                            text = stop.name,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = PhoneTextPrimary,
                            textAlign = TextAlign.Center,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false)
                        )

                        Box(
                            modifier = Modifier
                                .padding(start = 6.dp)
                                .size(26.dp)
                                .clip(CircleShape)
                                .background(if (stop.isFavorite) PhoneAmberContainer else PhoneCardBg)
                                .clickable {
                                    view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                                    onToggleFavorite()
                                },
                            contentAlignment = Alignment.Center
                        ) {
                            Text(text = if (stop.isFavorite) "⭐" else "☆", fontSize = 13.sp)
                        }
                    }

                    if (stop.street.isNotBlank()) {
                        Text(
                            text = "→ ${stop.street} • ${stop.code}",
                            fontSize = 10.sp,
                            color = PhonePrimaryBlue,
                            fontWeight = FontWeight.Bold
                        )
                    } else {
                        Text(
                            text = "Αφίξεις • ${stop.code}",
                            fontSize = 10.sp,
                            color = PhonePrimaryBlue,
                            fontWeight = FontWeight.Bold
                        )
                    }
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
                            // Left: Badge + Line + Destination
                            Row(
                                modifier = Modifier.weight(1f, fill = false),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
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

                                if (arr.destination.isNotBlank()) {
                                    Text(
                                        text = " ${arr.destination}",
                                        fontSize = 10.sp,
                                        color = PhoneTextMuted,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.padding(start = 4.dp)
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

            // Quick Actions: Back & Refresh (Navigation button removed per user request)
            item {
                Spacer(modifier = Modifier.height(10.dp))
                Row(
                    modifier = Modifier.padding(bottom = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // Minimal Circular Back Button (Same as Phone App)
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(PhoneCardBg)
                            .clickable { onBack() },
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "←",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            color = PhoneTextPrimary
                        )
                    }

                    // Refresh button
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(PhoneCardBg)
                            .clickable { onRefresh() },
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "🔄",
                            fontSize = 14.sp
                        )
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
