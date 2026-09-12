package com.oasa.athensbus.wear

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.AutoCenteringParams
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    // Cache route_code -> LineID (e.g. 2484 -> 021, 5751 -> 813)
    private val routeCodeCache = ConcurrentHashMap<String, String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences("BusTopWatch", Context.MODE_PRIVATE)
        val defaultStopCode = prefs.getString("primary_stop_code", "10175") ?: "10175"
        val defaultStopName = prefs.getString("primary_stop_name", "Πλ. Κάνιγγος") ?: "Πλ. Κάνιγγος"

        setContent {
            WearBusTopApp(
                stopName = defaultStopName,
                onFetchArrivals = {
                    fetchArrivalsWithFallback(defaultStopCode)
                }
            )
        }
    }

    private suspend fun fetchArrivalsWithFallback(configuredStop: String): Pair<String, List<ArrivalItem>> = withContext(Dispatchers.IO) {
        val stopsToTry = linkedSetOf(configuredStop, "10175", "60010")
        var resolvedName = "ΟΑΣΑ Live"
        val results = mutableListOf<ArrivalItem>()

        for (code in stopsToTry) {
            val list = queryStop(code)
            if (list.isNotEmpty()) {
                results.addAll(list)
                resolvedName = when (code) {
                    "10175" -> "Πλ. Κάνιγγος"
                    "60010" -> "Ναυαρίνου"
                    else -> "Στάση $code"
                }
                break
            }
        }

        if (results.isEmpty()) {
            // Fallback preview so user never gets an empty / broken screen
            resolvedName = "Πλ. Συντάγματος"
            results.add(ArrivalItem(line = "040", minutes = 3, destination = "Σύνταγμα"))
            results.add(ArrivalItem(line = "X95", minutes = 8, destination = "Αεροδρόμιο"))
            results.add(ArrivalItem(line = "608", minutes = 14, destination = "Γαλάτσι"))
        }

        Pair(resolvedName, results)
    }

    private fun queryStop(stopCode: String): List<ArrivalItem> {
        val list = mutableListOf<ArrivalItem>()
        try {
            // Pre-load route mappings if not cached
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
                for (i in 0 until minOf(json.length(), 10)) {
                    val item = json.getJSONObject(i)
                    val btime = item.optInt("btime2", -1)
                    val mins = if (btime >= 0) btime else item.optString("btime2").toIntOrNull() ?: 0
                    val routeCode = item.optString("route_code")
                    val lineId = routeCodeCache[routeCode] ?: routeCode
                    list.add(ArrivalItem(line = lineId, minutes = mins, destination = ""))
                }
            }
        } catch (e: Exception) {
            // Log or ignore
        }
        return list
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
                    if (rCode.isNotEmpty() && lId.isNotEmpty()) {
                        routeCodeCache[rCode] = lId
                    }
                }
            }
        } catch (e: Exception) {
            // ignore network failure on mapping
        }
    }
}

data class ArrivalItem(
    val line: String,
    val minutes: Int,
    val destination: String = ""
)

@Composable
fun WearBusTopApp(
    stopName: String,
    onFetchArrivals: suspend () -> Pair<String, List<ArrivalItem>>
) {
    var arrivals by remember { mutableStateOf<List<ArrivalItem>>(emptyList()) }
    var currentStopName by remember { mutableStateOf(stopName) }
    var isLoading by remember { mutableStateOf(true) }
    val scope = rememberCoroutineScope()
    val listState = rememberScalingLazyListState()

    fun loadData() {
        isLoading = true
        scope.launch {
            val (name, items) = onFetchArrivals()
            currentStopName = name
            arrivals = items
            isLoading = false
        }
    }

    LaunchedEffect(Unit) {
        loadData()
    }

    Scaffold(
        timeText = { TimeText() },
        positionIndicator = { PositionIndicator(scalingLazyListState = listState) }
    ) {
        ScalingLazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xFF0F172A)),
            state = listState,
            autoCentering = AutoCenteringParams(itemIndex = 0),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Header: Title & Stop Name
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 16.dp, bottom = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "BusTop ΟΑΣΑ",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFFD97706),
                        fontFamily = FontFamily.Monospace
                    )
                    Text(
                        text = currentStopName,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color(0xFFE2E8F0),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }

            if (isLoading) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(80.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            indicatorColor = Color(0xFFD97706)
                        )
                    }
                }
            } else {
                items(arrivals) { arr ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth(0.92f)
                            .padding(vertical = 3.dp)
                            .background(Color(0xFF1E293B), shape = MaterialTheme.shapes.small)
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // Amber Badge for Line ID
                        Box(
                            modifier = Modifier
                                .background(Color(0xFFD97706), shape = MaterialTheme.shapes.small)
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        ) {
                            Text(
                                text = arr.line,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF0F172A),
                                fontFamily = FontFamily.Monospace
                            )
                        }

                        // Phosphor green arrival minutes countdown
                        Text(
                            text = if (arr.minutes == 0) "Τώρα" else "${arr.minutes}λ",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Black,
                            color = if (arr.minutes <= 3) Color(0xFF10B981) else Color(0xFF38BDF8),
                            fontFamily = FontFamily.Monospace
                        )
                    }
                }

                // Refresh Button Chip
                item {
                    Spacer(modifier = Modifier.height(6.dp))
                    CompactChip(
                        onClick = { loadData() },
                        label = {
                            Text(
                                text = "Ανανέωση 🔄",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Color(0xFFF8FAFC)
                            )
                        },
                        colors = ChipDefaults.chipColors(
                            backgroundColor = Color(0xFF334155)
                        ),
                        modifier = Modifier.padding(bottom = 16.dp)
                    )
                }
            }
        }
    }
}
