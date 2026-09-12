package com.oasa.athensbus.wear

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
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
                onFetchArrivals = { code -> queryStopArrivals(code) }
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

    private suspend fun fetchNearbyStopsList(): List<WearStopItem> = withContext(Dispatchers.IO) {
        val (lat, lng) = getLastKnownLocation()
        val list = mutableListOf<WearStopItem>()
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
                    if (sCode.isNotEmpty()) {
                        list.add(WearStopItem(code = sCode, name = sName, distanceMeters = dist))
                    }
                }
            }
        } catch (_: Exception) {}

        if (list.isEmpty()) {
            list.add(WearStopItem("10175", "Πλ. Κάνιγγος", 85))
            list.add(WearStopItem("60010", "Ναυαρίνου", 160))
            list.add(WearStopItem("10022", "Πλ. Συντάγματος", 280))
            list.add(WearStopItem("10034", "Ακαδημία", 320))
            list.add(WearStopItem("10018", "Ομόνοια", 410))
        }
        list
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
        list
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
    val distanceMeters: Int = 0
)

data class ArrivalItem(
    val line: String,
    val minutes: Int
)

// ─── Colours ──────────────────────────────────────────────────────────────────

private val BgDeep      = Color(0xFF0F172A)
private val BgCard      = Color(0xFF1E293B)
private val Amber       = Color(0xFFD97706)
private val Sky         = Color(0xFF38BDF8)
private val Green       = Color(0xFF10B981)
private val TextPrimary = Color(0xFFF1F5F9)
private val TextMuted   = Color(0xFF94A3B8)

// ─── Root app composable ──────────────────────────────────────────────────────

@Composable
fun WearBusTopApp(
    onFetchNearbyStops: suspend () -> List<WearStopItem>,
    onFetchArrivals: suspend (String) -> List<ArrivalItem>
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
    // Use screen height so each tile fills one page
    val screenHeight = LocalConfiguration.current.screenHeightDp.dp

    Scaffold(
        timeText = {
            TimeText(
                modifier = Modifier.fillMaxWidth(),
                timeTextStyle = TimeTextDefaults.timeTextStyle(fontSize = 11.sp, color = TextMuted)
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
                edgeScale = 0.85f,
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
            .clip(RoundedCornerShape(16.dp))
            .background(BgCard)
            .clickable { onClick() },
        contentAlignment = Alignment.TopCenter
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 12.dp, vertical = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Stop name
            Text(
                text = stop.name,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = TextPrimary,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(8.dp))

            when {
                arrivals == null -> {
                    Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            indicatorColor = Amber
                        )
                    }
                }
                arrivals.isEmpty() -> {
                    Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        Text(
                            text = "Δεν υπάρχουν\nδρομολόγια",
                            fontSize = 11.sp,
                            color = TextMuted,
                            textAlign = TextAlign.Center,
                            lineHeight = 16.sp
                        )
                    }
                }
                else -> {
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(5.dp)
                    ) {
                        arrivals.take(4).forEach { arr ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(Amber)
                                        .padding(horizontal = 6.dp, vertical = 2.dp)
                                ) {
                                    Text(
                                        text = arr.line,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = BgDeep
                                    )
                                }
                                Text(
                                    text = if (arr.minutes == 0) "Τώρα" else "${arr.minutes}λ",
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Black,
                                    color = if (arr.minutes <= 3) Green else Sky
                                )
                            }
                        }
                        if (arrivals.size > 4) {
                            Text(
                                text = "+${arrivals.size - 4} ακόμα →",
                                fontSize = 10.sp,
                                color = TextMuted,
                                modifier = Modifier.fillMaxWidth(),
                                textAlign = TextAlign.End
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "πατήστε για όλες",
                fontSize = 9.sp,
                color = TextMuted,
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
    onRefresh: () -> Unit
) {
    val listState = rememberScalingLazyListState(initialCenterItemIndex = 0)

    Scaffold(
        timeText = {
            TimeText(
                modifier = Modifier.fillMaxWidth(),
                timeTextStyle = TimeTextDefaults.timeTextStyle(fontSize = 11.sp, color = TextMuted)
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
            // Title
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 24.dp, bottom = 8.dp, start = 12.dp, end = 12.dp),
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
                        text = "Αφίξεις",
                        fontSize = 10.sp,
                        color = Amber,
                        fontWeight = FontWeight.SemiBold
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
                                indicatorColor = Amber
                            )
                        }
                    }
                }
                arrivals.isEmpty() -> {
                    item {
                        Text(
                            text = "Δεν υπάρχουν\nδρομολόγια",
                            fontSize = 12.sp,
                            color = TextMuted,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(24.dp),
                            lineHeight = 18.sp
                        )
                    }
                }
                else -> {
                    items(arrivals) { arr ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth(0.92f)
                                .padding(vertical = 2.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(BgCard)
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(Amber)
                                    .padding(horizontal = 7.dp, vertical = 3.dp)
                            ) {
                                Text(
                                    text = arr.line,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = BgDeep
                                )
                            }
                            Text(
                                text = when {
                                    arr.minutes == 0 -> "Τώρα"
                                    arr.minutes == 1 -> "1 λεπτό"
                                    else -> "${arr.minutes} λεπτά"
                                },
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Black,
                                color = if (arr.minutes <= 3) Green else Sky
                            )
                        }
                    }
                }
            }

            // Action buttons
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    modifier = Modifier.padding(bottom = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
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
                        colors = ChipDefaults.chipColors(backgroundColor = Color(0xFF334155))
                    )
                    CompactChip(
                        onClick = onRefresh,
                        label = { Text("🔄", fontSize = 13.sp) },
                        colors = ChipDefaults.chipColors(backgroundColor = Color(0xFF334155))
                    )
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
            CircularProgressIndicator(modifier = Modifier.size(32.dp), indicatorColor = Amber)
            Spacer(modifier = Modifier.height(12.dp))
            Text(text = "Φόρτωση στάσεων…", fontSize = 12.sp, color = TextMuted)
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
                color = TextMuted,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(12.dp))
            CompactChip(
                onClick = onRefresh,
                label = { Text("Ανανέωση 🔄", fontSize = 11.sp, color = TextPrimary) },
                colors = ChipDefaults.chipColors(backgroundColor = Color(0xFF334155))
            )
        }
    }
}
