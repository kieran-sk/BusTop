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
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
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
                onNavigateToStop = { lat, lng, name -> navigateToStop(lat, lng, name) }
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
                for (i in 0 until minOf(arr.length(), 20)) {
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

// ─── Data classes ─────────────────────────────────────────────────────────────

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

// ─── Clean Expressive Theme Palette ──────────────────────────────────────────

private val BgDeep          = Color(0xFF0B132B) // Clean Midnight Slate
private val BgCard          = Color(0xFF1C2541) // Elevated Slate Surface
private val PrimaryBlue     = Color(0xFF005AC1) // Clean Primary Blue
private val PrimaryPill     = Color(0xFFE0F2FE) // High contrast Light Blue badge
private val PrimaryText     = Color(0xFF0369A1) // Deep text on Light Blue badge
private val AmberGold       = Color(0xFFF59E0B) // Favorite accent
private val LiveGreen       = Color(0xFF10B981) // Imminent arrival
private val SkyBlue         = Color(0xFF38BDF8) // Normal arrival
private val TextPrimary     = Color(0xFFF8FAFC) // Clean Crisp White
private val TextSecondary   = Color(0xFF94A3B8) // Muted Info
private val BorderSubtle    = Color(0xFF334155) // Card border line

// ─── Root app composable ──────────────────────────────────────────────────────

@Composable
fun WearBusTopApp(
    onFetchNearbyStops: suspend () -> List<WearStopItem>,
    onFetchArrivals: suspend (String) -> List<ArrivalItem>,
    onNavigateToStop: (Double, Double, String) -> Unit
) {
    val arrivalsMap = remember { mutableStateMapOf<String, List<ArrivalItem>>() }
    var stops by remember { mutableStateOf<List<WearStopItem>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var selectedStop by remember { mutableStateOf<WearStopItem?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun loadAll() {
        isLoading = true
        val fetched = onFetchNearbyStops()
        stops = fetched
        isLoading = false
        fetched.forEach { stop ->
            scope.launch {
                arrivalsMap[stop.code] = onFetchArrivals(stop.code)
            }
        }
    }

    // Initial load
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
            onBack = { selectedStop = null },
            onRefresh = {
                scope.launch {
                    arrivalsMap[selectedStop!!.code] = onFetchArrivals(selectedStop!!.code)
                }
            },
            onNavigate = {
                onNavigateToStop(selectedStop!!.lat, selectedStop!!.lng, selectedStop!!.name)
            }
        )
    } else {
        StopPagerScreen(
            stops = stops,
            arrivalsMap = arrivalsMap,
            isLoading = isLoading,
            onStopTap = { stop -> selectedStop = stop },
            onRefresh = { scope.launch { loadAll() } }
        )
    }
}

// ─── Stop pager ───────────────────────────────────────────────────────────────

@Composable
fun StopPagerScreen(
    stops: List<WearStopItem>,
    arrivalsMap: Map<String, List<ArrivalItem>>,
    isLoading: Boolean,
    onStopTap: (WearStopItem) -> Unit,
    onRefresh: () -> Unit
) {
    if (isLoading) { LoadingScreen(); return }
    if (stops.isEmpty()) { EmptyScreen(onRefresh); return }

    val listState = rememberScalingLazyListState(initialCenterItemIndex = 0)
    val screenHeight = LocalConfiguration.current.screenHeightDp.dp

    Scaffold(
        timeText = {
            TimeText(
                modifier = Modifier.fillMaxWidth(),
                timeTextStyle = TimeTextDefaults.timeTextStyle(fontSize = 11.sp, color = TextSecondary)
            )
        },
        positionIndicator = { PositionIndicator(scalingLazyListState = listState) }
    ) {
        ScalingLazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .background(BgDeep),
            state = listState,
            autoCentering = AutoCenteringParams(itemIndex = 0),
            contentPadding = PaddingValues(0.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            scalingParams = ScalingLazyColumnDefaults.scalingParams(
                edgeScale = 0.88f,
                edgeAlpha = 0.6f,
                minTransitionArea = 0.2f,
                maxTransitionArea = 0.6f
            )
        ) {
            items(stops) { stop ->
                StopPageTile(
                    stop = stop,
                    arrivals = arrivalsMap[stop.code],
                    tileHeight = screenHeight,
                    onClick = { onStopTap(stop) }
                )
            }
        }
    }
}

// ─── Full-screen stop tile ────────────────────────────────────────────────────

@Composable
fun StopPageTile(
    stop: WearStopItem,
    arrivals: List<ArrivalItem>?,
    tileHeight: androidx.compose.ui.unit.Dp,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(tileHeight)
            .padding(horizontal = 8.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(BgCard)
            .clickable { onClick() },
        contentAlignment = Alignment.TopCenter
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 12.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Header: Stop Name + Favorite / Distance tag
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (stop.isFavorite) {
                    Text(text = "⭐ ", fontSize = 11.sp)
                }
                Text(
                    text = stop.name,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }

            if (stop.distanceMeters > 0) {
                Text(
                    text = "${stop.distanceMeters}μ μακριά",
                    fontSize = 10.sp,
                    color = TextSecondary,
                    modifier = Modifier.padding(top = 1.dp, bottom = 4.dp)
                )
            } else {
                Spacer(modifier = Modifier.height(4.dp))
            }

            when {
                arrivals == null -> {
                    Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(22.dp),
                            indicatorColor = SkyBlue
                        )
                    }
                }
                arrivals.isEmpty() -> {
                    Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        Text(
                            text = "Δεν υπάρχουν\nδρομολόγια",
                            fontSize = 11.sp,
                            color = TextSecondary,
                            textAlign = TextAlign.Center,
                            lineHeight = 16.sp
                        )
                    }
                }
                else -> {
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        arrivals.take(4).forEach { arr ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Color(0xFF0F172A))
                                    .padding(horizontal = 8.dp, vertical = 3.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(5.dp))
                                        .background(PrimaryPill)
                                        .padding(horizontal = 6.dp, vertical = 2.dp)
                                ) {
                                    Text(
                                        text = arr.line,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.ExtraBold,
                                        color = PrimaryText
                                    )
                                }
                                Text(
                                    text = if (arr.minutes == 0) "Τώρα" else "${arr.minutes}'",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Black,
                                    color = if (arr.minutes <= 3) LiveGreen else SkyBlue
                                )
                            }
                        }
                        if (arrivals.size > 4) {
                            Text(
                                text = "+${arrivals.size - 4} ακόμη →",
                                fontSize = 10.sp,
                                color = TextSecondary,
                                modifier = Modifier.fillMaxWidth(),
                                textAlign = TextAlign.End
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = "πατήστε για λεπτομέρειες",
                fontSize = 9.sp,
                color = TextSecondary,
                textAlign = TextAlign.Center
            )
        }
    }
}

// ─── Arrivals detail screen ───────────────────────────────────────────────────

@Composable
fun ArrivalsScreen(
    stop: WearStopItem,
    arrivals: List<ArrivalItem>?,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onNavigate: () -> Unit
) {
    val listState = rememberScalingLazyListState(initialCenterItemIndex = 0)

    Scaffold(
        timeText = {
            TimeText(
                modifier = Modifier.fillMaxWidth(),
                timeTextStyle = TimeTextDefaults.timeTextStyle(fontSize = 11.sp, color = TextSecondary)
            )
        },
        positionIndicator = { PositionIndicator(scalingLazyListState = listState) }
    ) {
        ScalingLazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .background(BgDeep),
            state = listState,
            autoCentering = AutoCenteringParams(itemIndex = 0),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Header Stop Title
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 22.dp, bottom = 6.dp, start = 12.dp, end = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = stop.name,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = "Αφίξεις σε πραγματικό χρόνο",
                        fontSize = 10.sp,
                        color = SkyBlue,
                        fontWeight = FontWeight.Medium
                    )
                }
            }

            when {
                arrivals == null -> {
                    item {
                        Box(
                            modifier = Modifier.fillMaxWidth().height(80.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(24.dp),
                                indicatorColor = SkyBlue
                            )
                        }
                    }
                }
                arrivals.isEmpty() -> {
                    item {
                        Text(
                            text = "Δεν υπάρχουν\nπρογραμματισμένες αφίξεις",
                            fontSize = 12.sp,
                            color = TextSecondary,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(20.dp),
                            lineHeight = 18.sp
                        )
                    }
                }
                else -> {
                    items(arrivals) { arr ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth(0.92f)
                                .padding(vertical = 2.5.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(BgCard)
                                .padding(horizontal = 10.dp, vertical = 7.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(PrimaryPill)
                                    .padding(horizontal = 7.dp, vertical = 3.dp)
                            ) {
                                Text(
                                    text = arr.line,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = PrimaryText
                                )
                            }
                            Text(
                                text = when {
                                    arr.minutes == 0 -> "Τώρα"
                                    arr.minutes == 1 -> "1 λεπτό"
                                    else -> "${arr.minutes}'"
                                },
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Black,
                                color = if (arr.minutes <= 3) LiveGreen else SkyBlue
                            )
                        }
                    }
                }
            }

            // Quick Actions: Direct Google Maps Navigation, Back, and Refresh
            item {
                Spacer(modifier = Modifier.height(6.dp))
                Column(
                    modifier = Modifier.padding(bottom = 22.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    // Navigation Chip
                    CompactChip(
                        onClick = onNavigate,
                        label = {
                            Text(
                                "🧭 Πλοήγηση στη στάση",
                                fontSize = 11.sp,
                                color = TextPrimary,
                                fontWeight = FontWeight.Bold
                            )
                        },
                        colors = ChipDefaults.chipColors(backgroundColor = PrimaryBlue),
                        modifier = Modifier.fillMaxWidth(0.85f)
                    )

                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // Back Button
                        CompactChip(
                            onClick = onBack,
                            label = {
                                Text(
                                    "← Πίσω",
                                    fontSize = 11.sp,
                                    color = TextPrimary,
                                    fontWeight = FontWeight.SemiBold
                                )
                            },
                            colors = ChipDefaults.chipColors(backgroundColor = BorderSubtle)
                        )
                        // Refresh Button
                        CompactChip(
                            onClick = onRefresh,
                            label = { Text("🔄", fontSize = 13.sp) },
                            colors = ChipDefaults.chipColors(backgroundColor = BorderSubtle)
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
            .background(BgDeep),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(modifier = Modifier.size(32.dp), indicatorColor = SkyBlue)
            Spacer(modifier = Modifier.height(12.dp))
            Text(text = "Φόρτωση στάσεων…", fontSize = 12.sp, color = TextSecondary)
        }
    }
}

@Composable
fun EmptyScreen(onRefresh: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(BgDeep),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = "Δεν βρέθηκαν στάσεις",
                fontSize = 12.sp,
                color = TextSecondary,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(12.dp))
            CompactChip(
                onClick = onRefresh,
                label = { Text("Ανανέωση 🔄", fontSize = 11.sp, color = TextPrimary) },
                colors = ChipDefaults.chipColors(backgroundColor = BorderSubtle)
            )
        }
    }
}

