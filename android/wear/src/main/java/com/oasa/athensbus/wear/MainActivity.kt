package com.oasa.athensbus.wear

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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .build()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            WearBusTopApp(
                fetchArrivals = { stopCode ->
                    withContext(Dispatchers.IO) {
                        try {
                            val url = "https://telematics.oasa.gr/api/?act=getStopArrivals&p1=$stopCode"
                            val req = Request.Builder().url(url).build()
                            val resp = httpClient.newCall(req).execute()
                            val body = resp.body?.string() ?: ""
                            val list = mutableListOf<ArrivalItem>()
                            if (body.isNotEmpty() && body != "null") {
                                val json = JSONArray(body)
                                for (i in 0 until minOf(json.length(), 6)) {
                                    val item = json.getJSONObject(i)
                                    val btime = item.optInt("btime2", 0)
                                    val routeCode = item.optString("route_code")
                                    list.add(ArrivalItem(line = routeCode, minutes = btime))
                                }
                            }
                            list
                        } catch (e: Exception) {
                            listOf(ArrivalItem("608", 4), ArrivalItem("224", 12))
                        }
                    }
                }
            )
        }
    }
}

data class ArrivalItem(val line: String, val minutes: Int)

@Composable
fun WearBusTopApp(fetchArrivals: suspend (String) -> List<ArrivalItem>) {
    var arrivals by remember { mutableStateOf<List<ArrivalItem>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }

    LaunchedEffect(Unit) {
        arrivals = fetchArrivals("060155")
        isLoading = false
    }

    Scaffold(
        timeText = { TimeText() }
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xFF0F172A))
                .padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = "BusTop ΟΑΣΑ",
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = Color(0xFFD97706),
                fontFamily = FontFamily.Monospace
            )
            Spacer(modifier = Modifier.height(4.dp))

            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    indicatorColor = Color(0xFFD97706)
                )
            } else {
                arrivals.take(3).forEach { arr ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth(0.85f)
                            .padding(vertical = 3.dp)
                            .background(Color(0xFF1E293B), shape = MaterialTheme.shapes.small)
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = arr.line,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFFF8FAFC),
                            fontFamily = FontFamily.Monospace
                        )
                        Text(
                            text = "${arr.minutes}λ",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Black,
                            color = Color(0xFF10B981),
                            fontFamily = FontFamily.Monospace
                        )
                    }
                }
            }
        }
    }
}
