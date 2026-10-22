package com.oasa.athensbus.wear

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.HapticFeedbackConstants
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
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

    companion object {
        var instance: MainActivity? = null
    }

    var companionArrivalsListener: ((WearStopItem, List<ArrivalItem>) -> Unit)? = null
    var companionPinsListener: ((List<PinnedItem>, Boolean) -> Unit)? = null

    override fun onDestroy() {
        if (instance === this) {
            instance = null
        }
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleCompanionIntent(intent)
    }

    private fun handleCompanionIntent(intent: Intent?) {
        if (intent == null) return
        val payload = intent.getStringExtra(WearCompanionListenerService.EXTRA_PAYLOAD) ?: return
        when (intent.action) {
            WearCompanionListenerService.ACTION_SYNC_PINS -> {
                onPinsReceived(payload, shouldNavigateToPins = true)
            }
            WearCompanionListenerService.ACTION_SHOW_ARRIVALS -> {
                onArrivalsReceived(payload)
            }
        }
    }

    fun onPinsReceived(jsonStr: String, shouldNavigateToPins: Boolean = false) {
        try {
            val list = mutableListOf<PinnedItem>()
            val arr = JSONArray(jsonStr)
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                val stopCode = obj.optString("stopCode", obj.optString("code", ""))
                val lineId = obj.optString("lineId", obj.optString("line", "BUS"))
                val stopName = obj.optString("stopName", "Στάση $stopCode")
                val destination = obj.optString("destination", "")
                val mins = if (obj.has("minutes")) obj.optInt("minutes", 0) else obj.optInt("btime2", 0)
                if (stopCode.isNotEmpty() && lineId.isNotEmpty()) {
                    list.add(PinnedItem(
                        stopCode = stopCode,
                        stopName = stopName,
                        lineId = lineId,
                        destination = destination,
                        minutes = mins
                    ))
                }
            }
            runOnUiThread {
                companionPinsListener?.invoke(list, shouldNavigateToPins)
            }
        } catch (_: Exception) {}
    }

    fun onArrivalsReceived(jsonStr: String) {
        try {
            val obj = JSONObject(jsonStr)
            val stopCode = obj.optString("stopCode", "")
            val stopName = obj.optString("stopName", "Στάση $stopCode")
            val stopStreet = obj.optString("stopStreet", "")
            val stopLat = obj.optDouble("stopLat", 0.0)
            val stopLng = obj.optDouble("stopLng", 0.0)

            val arrivalsList = mutableListOf<ArrivalItem>()
            val arrJson = obj.optJSONArray("arrivals")
            if (arrJson != null) {
                for (i in 0 until arrJson.length()) {
                    val aObj = arrJson.getJSONObject(i)
                    val line = aObj.optString("line_id", aObj.optString("line", "BUS"))
                    val mins = if (aObj.has("btime2")) aObj.optInt("btime2", 0) else aObj.optInt("minutes", 0)
                    val dest = aObj.optString("destination", aObj.optString("route_descr", ""))
                    arrivalsList.add(ArrivalItem(line = line, minutes = mins, destination = dest))
                }
            }
            val stopItem = WearStopItem(
                code = stopCode,
                name = stopName,
                street = stopStreet,
                lat = stopLat,
                lng = stopLng
            )
            runOnUiThread {
                companionArrivalsListener?.invoke(stopItem, arrivalsList)
            }
        } catch (_: Exception) {}
    }

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .build()

    private val routeCodeCache = ConcurrentHashMap<String, String>()
    private val routeDescrCache = ConcurrentHashMap<String, String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        instance = this
        handleCompanionIntent(intent)
        setContent {
            WearBusTopApp(
                onFetchArrivals = { code -> queryStopArrivals(code) },
                onLoadPins = { loadPinnedItems() },
                onLoadLastProjected = { loadCachedProjectedStop() }
            )
        }
    }

    fun loadPinnedItems(): List<PinnedItem> {
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
                        val destination = obj.optString("destination", "")
                        val mins = if (obj.has("minutes")) obj.optInt("minutes", 0) else obj.optInt("btime2", 0)
                        if (stopCode.isNotEmpty() && lineId.isNotEmpty() && list.none { it.stopCode == stopCode && it.lineId == lineId }) {
                            list.add(PinnedItem(
                                stopCode = stopCode,
                                stopName = stopName,
                                lineId = lineId,
                                destination = destination,
                                minutes = mins
                            ))
                        }
                    }
                    if (list.isNotEmpty()) break
                } catch (_: Exception) {}
            }
        }
        return list
    }

    fun loadCachedProjectedStop(): Pair<WearStopItem, List<ArrivalItem>>? {
        try {
            val prefs = getSharedPreferences("BusTopWatch", Context.MODE_PRIVATE)
            val raw = prefs.getString("last_projected_stop", null) ?: return null
            val obj = JSONObject(raw)
            val stopCode = obj.optString("stopCode", "")
            if (stopCode.isEmpty()) return null
            val stopName = obj.optString("stopName", "Στάση $stopCode")
            val stopStreet = obj.optString("stopStreet", "")
            val stopLat = obj.optDouble("stopLat", 0.0)
            val stopLng = obj.optDouble("stopLng", 0.0)

            val arrivalsList = mutableListOf<ArrivalItem>()
            val arrJson = obj.optJSONArray("arrivals")
            if (arrJson != null) {
                for (i in 0 until arrJson.length()) {
                    val aObj = arrJson.getJSONObject(i)
                    val line = aObj.optString("line_id", aObj.optString("line", "BUS"))
                    val mins = if (aObj.has("btime2")) aObj.optInt("btime2", 0) else aObj.optInt("minutes", 0)
                    val dest = aObj.optString("destination", aObj.optString("route_descr", ""))
                    arrivalsList.add(ArrivalItem(line = line, minutes = mins, destination = dest))
                }
            }
            return Pair(
                WearStopItem(code = stopCode, name = stopName, street = stopStreet, lat = stopLat, lng = stopLng),
                arrivalsList
            )
        } catch (_: Exception) {
            return null
        }
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
    val lineId: String,
    val destination: String = "",
    val minutes: Int = 0
)

// ─── Wear OS Dark OLED Aesthetic Theme Palette ──────────────────────────────

private val WearSurfaceBg       = Color(0xFF000000) // Pure OLED Black to blend into watch bezel seamlessly
private val WearCardBg          = Color(0xFF161C26) // Deep Navy/Slate surface card
private val PhonePrimaryBlue    = Color(0xFF38BDF8) // Crisp Electric Blue for AMOLED
private val PhonePrimaryPill    = Color(0xFF1E3A8A) // Dark Indigo Pill Container
private val PhonePrimaryText    = Color(0xFF93C5FD) // Crisp light blue badge text
private val PhoneTextPrimary    = Color(0xFFF8FAFC) // Crisp White for dark background
private val PhoneTextMuted      = Color(0xFF94A3B8) // Clean muted slate secondary text
private val PhoneLiveGreen      = Color(0xFF34D399) // Phosphor Emerald

// ─── Root app composable with Smooth Swipe Pager Navigation ───────────────────

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun WearBusTopApp(
    onFetchArrivals: suspend (String) -> List<ArrivalItem>,
    onLoadPins: () -> List<PinnedItem>,
    onLoadLastProjected: () -> Pair<WearStopItem, List<ArrivalItem>>?
) {
    val pagerState = rememberPagerState(initialPage = 0, pageCount = { 2 })
    var pinnedList by remember { mutableStateOf<List<PinnedItem>>(emptyList()) }
    var projectedStop by remember { mutableStateOf<WearStopItem?>(null) }
    var projectedArrivals by remember { mutableStateOf<List<ArrivalItem>>(emptyList()) }
    val scope = rememberCoroutineScope()

    // Register tandem companion hooks from phone
    LaunchedEffect(Unit) {
        pinnedList = onLoadPins()
        val cachedProjected = onLoadLastProjected()
        if (cachedProjected != null) {
            projectedStop = cachedProjected.first
            projectedArrivals = cachedProjected.second
        }

        val act = MainActivity.instance
        if (act != null) {
            act.companionPinsListener = { newPins, shouldNavigate ->
                pinnedList = newPins
                if (shouldNavigate) {
                    scope.launch {
                        pagerState.animateScrollToPage(0)
                    }
                }
            }
            act.companionArrivalsListener = { sharedStop, sharedArrivals ->
                projectedStop = sharedStop
                projectedArrivals = sharedArrivals
                scope.launch {
                    pagerState.animateScrollToPage(1)
                }
            }
        }
    }

    // Live auto-refresh every 20 seconds for pinned arrivals (fetching live API per stop directly on watch)
    LaunchedEffect(pinnedList.map { it.stopCode }.distinct()) {
        val stops = pinnedList.map { it.stopCode }.filter { it.isNotBlank() }.distinct()
        if (stops.isEmpty()) return@LaunchedEffect
        while (true) {
            delay(20_000)
            val updated = pinnedList.toMutableList()
            var anyChanged = false
            for (s in stops) {
                val arrivals = onFetchArrivals(s)
                if (arrivals.isNotEmpty()) {
                    for (i in updated.indices) {
                        val pin = updated[i]
                        if (pin.stopCode == s) {
                            val match = arrivals.firstOrNull { it.line.equals(pin.lineId, ignoreCase = true) }
                            if (match != null && match.minutes != pin.minutes) {
                                updated[i] = pin.copy(minutes = match.minutes)
                                anyChanged = true
                            }
                        }
                    }
                }
            }
            if (anyChanged) {
                pinnedList = updated
            }
        }
    }

    // Live auto-refresh every 25 seconds for the projected stop
    LaunchedEffect(projectedStop?.code) {
        val sCode = projectedStop?.code ?: return@LaunchedEffect
        while (true) {
            delay(25_000)
            val fresh = onFetchArrivals(sCode)
            if (fresh.isNotEmpty()) {
                projectedArrivals = fresh
            }
        }
    }

    Scaffold(
        timeText = {
            TimeText(
                modifier = Modifier.fillMaxWidth(),
                timeTextStyle = TimeTextDefaults.timeTextStyle(fontSize = 10.sp, color = PhoneTextMuted)
            )
        }
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(WearSurfaceBg)
        ) {
            HorizontalPager(
                state = pagerState,
                modifier = Modifier.fillMaxSize()
            ) { page ->
                when (page) {
                    0 -> {
                        PinnedTabScreen(
                            pinnedList = pinnedList,
                            onRefresh = {
                                pinnedList = onLoadPins()
                            }
                        )
                    }
                    1 -> {
                        ProjectedTabScreen(
                            stop = projectedStop,
                            arrivals = projectedArrivals,
                            onRefresh = {
                                val sCode = projectedStop?.code
                                if (sCode != null) {
                                    scope.launch {
                                        val fresh = onFetchArrivals(sCode)
                                        if (fresh.isNotEmpty()) {
                                            projectedArrivals = fresh
                                        }
                                    }
                                }
                            }
                        )
                    }
                }
            }

            // Minimalist dot indicator at the bottom edge so it takes 0 content space
            Row(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(if (pagerState.currentPage == 0) 5.dp else 3.5.dp)
                        .clip(CircleShape)
                        .background(if (pagerState.currentPage == 0) PhonePrimaryBlue else PhoneTextMuted.copy(alpha = 0.4f))
                )
                Box(
                    modifier = Modifier
                        .size(if (pagerState.currentPage == 1) 5.dp else 3.5.dp)
                        .clip(CircleShape)
                        .background(if (pagerState.currentPage == 1) PhonePrimaryBlue else PhoneTextMuted.copy(alpha = 0.4f))
                )
            }
        }
    }
}


// ─── Wear Split-Flap Arrival Digit Board ─────────────────────────────────────

@Composable
fun WearSplitFlapTile(
    char: Char,
    isUrgent: Boolean,
    isSoon: Boolean,
    tileWidth: androidx.compose.ui.unit.Dp = 13.dp,
    tileHeight: androidx.compose.ui.unit.Dp = 20.dp,
    fontSize: androidx.compose.ui.unit.TextUnit = 12.sp
) {
    val tileBg = when {
        isUrgent -> Color(0xFF450A0A) // Deep wine red
        isSoon -> Color(0xFF052E16)   // Deep dark emerald
        else -> Color(0xFF0F172A)     // Deep slate flap
    }
    val tileBorder = when {
        isUrgent -> Color(0xFFEF4444)
        isSoon -> Color(0xFF10B981)
        else -> Color(0xFF334155)
    }
    val textColor = when {
        isUrgent -> Color(0xFFFCA5A5)
        isSoon -> Color(0xFF6EE7B7)
        else -> Color(0xFFF8FAFC)
    }

    Box(
        modifier = Modifier
            .width(tileWidth)
            .height(tileHeight)
            .clip(RoundedCornerShape(4.dp))
            .background(tileBg)
            .border(0.85.dp, tileBorder, RoundedCornerShape(4.dp)),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = char.toString(),
            fontSize = fontSize,
            fontWeight = FontWeight.Black,
            color = textColor,
            textAlign = TextAlign.Center
        )
        // Split-flap horizontal center seam
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(0.6.dp)
                .background(Color(0x55000000))
                .align(Alignment.Center)
        )
    }
}

@Composable
fun WearSplitFlapDisplay(
    minutes: Int,
    modifier: Modifier = Modifier,
    tileWidth: androidx.compose.ui.unit.Dp = 13.dp,
    tileHeight: androidx.compose.ui.unit.Dp = 20.dp,
    fontSize: androidx.compose.ui.unit.TextUnit = 12.sp
) {
    val isUrgent = minutes in 1..3
    val isSoon = minutes in 4..10
    val text = when {
        minutes <= 0 -> "🏁"
        minutes >= 60 -> {
            val h = minutes / 60
            val m = minutes % 60
            if (m > 0) "${h}h${m}" else "${h}h"
        }
        else -> minutes.toString().padStart(2, '0')
    }

    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        text.forEach { ch ->
            WearSplitFlapTile(
                char = ch,
                isUrgent = isUrgent,
                isSoon = isSoon,
                tileWidth = tileWidth,
                tileHeight = tileHeight,
                fontSize = fontSize
            )
        }
        if (minutes > 0) {
            Text(
                text = "'",
                fontSize = fontSize,
                fontWeight = FontWeight.Black,
                color = when {
                    isUrgent -> Color(0xFFEF4444)
                    isSoon -> Color(0xFF10B981)
                    else -> PhoneTextMuted
                },
                modifier = Modifier.padding(start = 1.dp)
            )
        }
    }
}

// ─── TAB 1: Pinned Arrivals (Expanded edge-to-edge layout filling screen) ─────

@Composable
fun PinnedTabScreen(
    pinnedList: List<PinnedItem>,
    onRefresh: () -> Unit
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

    ScalingLazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(WearSurfaceBg)
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
        contentPadding = PaddingValues(start = 1.dp, end = 1.dp, top = 2.dp, bottom = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        scalingParams = ScalingLazyColumnDefaults.scalingParams(
            edgeScale = 0.96f,
            edgeAlpha = 0.85f,
            minTransitionArea = 0.1f,
            maxTransitionArea = 0.5f
        )
    ) {
        if (pinnedList.isEmpty()) {
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth(0.96f)
                        .clip(RoundedCornerShape(16.dp))
                        .background(WearCardBg)
                        .padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "📌 Καρφίτσες",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = PhonePrimaryBlue
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "Καμία ενεργή καρφίτσα",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = PhoneTextPrimary,
                        textAlign = TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Καρφιτσώστε μια άφιξη στο κινητό για να εμφανιστεί εδώ.",
                        fontSize = 10.sp,
                        color = PhoneTextMuted,
                        textAlign = TextAlign.Center,
                        lineHeight = 13.sp
                    )
                }
            }
        } else {
            items(pinnedList) { pin ->
                val isSinglePin = pinnedList.size == 1
                
                // Prominent full-width hero card taking advantage of screen height
                Column(
                    modifier = Modifier
                        .fillMaxWidth(0.99f)
                        .clip(RoundedCornerShape(16.dp))
                        .background(WearCardBg)
                        .padding(
                            horizontal = 12.dp,
                            vertical = if (isSinglePin) 14.dp else 10.dp
                        )
                ) {
                    // Top row: Big Line Badge + Large Split-Flap Arrival Counter
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(PhonePrimaryPill)
                                .padding(
                                    horizontal = if (isSinglePin) 10.dp else 8.dp,
                                    vertical = if (isSinglePin) 5.dp else 3.5.dp
                                )
                        ) {
                            Text(
                                text = pin.lineId,
                                fontSize = if (isSinglePin) 17.sp else 14.sp,
                                fontWeight = FontWeight.Black,
                                color = PhonePrimaryText
                            )
                        }

                        // Prominent High-Visibility Split-Flap Timer
                        WearSplitFlapDisplay(
                            minutes = pin.minutes,
                            tileWidth = if (isSinglePin) 18.dp else 14.dp,
                            tileHeight = if (isSinglePin) 27.dp else 22.dp,
                            fontSize = if (isSinglePin) 17.sp else 13.sp
                        )
                    }

                    Spacer(modifier = Modifier.height(if (isSinglePin) 8.dp else 5.dp))

                    // Stop Name
                    Text(
                        text = pin.stopName,
                        fontSize = if (isSinglePin) 14.sp else 12.sp,
                        fontWeight = FontWeight.Black,
                        color = PhoneTextPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )

                    // Destination with arrow
                    if (pin.destination.isNotBlank()) {
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = "→ ${pin.destination}",
                            fontSize = if (isSinglePin) 12.sp else 10.5.sp,
                            fontWeight = FontWeight.Medium,
                            color = PhoneTextMuted,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
                Spacer(modifier = Modifier.height(6.dp))
            }
        }

        item {
            CompactChip(
                onClick = onRefresh,
                label = { Text("Ανανέωση 🔄", fontSize = 10.5.sp, color = PhoneTextPrimary, fontWeight = FontWeight.Bold) },
                colors = ChipDefaults.chipColors(backgroundColor = WearCardBg),
                modifier = Modifier.padding(top = 2.dp, bottom = 8.dp)
            )
        }
    }
}

// ─── TAB 2: Beamed Stop Arrivals (Live snapshot of stop from phone) ───────────

@Composable
fun ProjectedTabScreen(
    stop: WearStopItem?,
    arrivals: List<ArrivalItem>,
    onRefresh: () -> Unit
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

    ScalingLazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(WearSurfaceBg)
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
        contentPadding = PaddingValues(start = 2.dp, end = 2.dp, top = 2.dp, bottom = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        scalingParams = ScalingLazyColumnDefaults.scalingParams(
            edgeScale = 0.94f,
            edgeAlpha = 0.85f,
            minTransitionArea = 0.12f,
            maxTransitionArea = 0.5f
        )
    ) {
        if (stop == null) {
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth(0.96f)
                        .clip(RoundedCornerShape(16.dp))
                        .background(WearCardBg)
                        .padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "📡 Καμία στάση",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = PhoneTextPrimary,
                        textAlign = TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Πατήστε το κουμπί ⌚ στις Αφίξεις του κινητού για να μεταδώσετε ζωντανά τη στάση εδώ.",
                        fontSize = 10.sp,
                        color = PhoneTextMuted,
                        textAlign = TextAlign.Center,
                        lineHeight = 13.sp
                    )
                }
            }
        } else {
            // Stop header info
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth(0.96f)
                        .padding(bottom = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = stop.name,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Black,
                        color = PhoneTextPrimary,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = if (stop.street.isNotBlank()) "→ ${stop.street} • #${stop.code}" else "Αφίξεις • #${stop.code}",
                        fontSize = 10.5.sp,
                        color = PhonePrimaryBlue,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            if (arrivals.isEmpty()) {
                item {
                    Text(
                        text = "Δεν υπάρχουν προγραμματισμένες αφίξεις",
                        fontSize = 12.sp,
                        color = PhoneTextMuted,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(14.dp),
                        lineHeight = 15.sp
                    )
                }
            } else {
                items(arrivals) { arr ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth(0.99f)
                            .padding(vertical = 2.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(WearCardBg)
                            .padding(horizontal = 9.dp, vertical = 7.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // Badge + Destination
                        Row(
                            modifier = Modifier.weight(1f, fill = false),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(PhonePrimaryPill)
                                    .padding(horizontal = 7.dp, vertical = 2.5.dp)
                            ) {
                                Text(
                                    text = arr.line,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Black,
                                    color = PhonePrimaryText
                                )
                            }

                            if (arr.destination.isNotBlank()) {
                                Text(
                                    text = " ${arr.destination}",
                                    fontSize = 10.5.sp,
                                    color = PhoneTextMuted,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(start = 5.dp)
                                )
                            }
                        }

                        // Split-Flap Arrival Display
                        WearSplitFlapDisplay(
                            minutes = arr.minutes,
                            tileWidth = 14.dp,
                            tileHeight = 22.dp,
                            fontSize = 13.sp
                        )
                    }
                }
            }

            item {
                Spacer(modifier = Modifier.height(4.dp))
                CompactChip(
                    onClick = onRefresh,
                    label = { Text("Ανανέωση 🔄", fontSize = 10.5.sp, color = PhoneTextPrimary, fontWeight = FontWeight.Bold) },
                    colors = ChipDefaults.chipColors(backgroundColor = WearCardBg),
                    modifier = Modifier.padding(bottom = 8.dp)
                )
            }
        }
    }
}
