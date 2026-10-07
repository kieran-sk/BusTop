package com.oasa.athensbus

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.fragment.app.FragmentActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.maps.MapsInitializer
import android.content.res.Configuration
import android.os.PowerManager
import android.provider.Settings
import android.net.Uri
import android.view.View
import org.json.JSONObject

class MainActivity : FragmentActivity() {

    private lateinit var webView: WebView
    private val PERMISSION_REQUEST_CODE = 1001

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        currentInstance = this

        try {
            MapsInitializer.initialize(applicationContext, MapsInitializer.Renderer.LATEST) { renderer ->
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        NotificationHelper.createNotificationChannel(this)
        requestRequiredPermissions()
        initWebView()
    }

    private fun requestRequiredPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val needed = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), PERMISSION_REQUEST_CODE)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun initWebView() {
        webView = WebView(this)
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        setContentView(webView)

        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.setGeolocationEnabled(true)
        settings.allowFileAccess = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true

        webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                callback?.invoke(origin, true, false)
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: android.webkit.WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                return handleExternalUrl(url)
            }

            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                if (url == null) return false
                return handleExternalUrl(url)
            }

            private fun handleExternalUrl(url: String): Boolean {
                if (url.startsWith("https://bustop.pages.dev") || url.startsWith("file:///android_asset/")) {
                    return false
                }
                return try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    startActivity(intent)
                    true
                } catch (e: Exception) {
                    false
                }
            }

            override fun onReceivedError(
                view: WebView?,
                request: android.webkit.WebResourceRequest?,
                error: android.webkit.WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    view?.loadUrl("file:///android_asset/web/index.html")
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                isPageLoaded = true
                dispatchPendingStop()
                view?.evaluateJavascript("if (window.App && typeof window.App.applyMaterialYou === 'function') window.App.applyMaterialYou();", null)
            }
        }

        webView.addJavascriptInterface(WebAppInterface(this), "AndroidBridge")
        handleIntent(intent)
        webView.loadUrl("https://bustop.pages.dev")
    }

    private var isPageLoaded = false
    private var pendingStopCode: String? = null
    private var pendingStopName: String? = null

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent) {
        val stopCode = intent.getStringExtra(EXTRA_STOP_CODE)
        val stopName = intent.getStringExtra(EXTRA_STOP_NAME) ?: ""
        if (!stopCode.isNullOrBlank()) {
            pendingStopCode = stopCode
            pendingStopName = stopName
            if (isPageLoaded) {
                dispatchPendingStop()
            }
        }
    }

    private fun dispatchPendingStop() {
        val code = pendingStopCode
        val name = (pendingStopName ?: "").replace("'", "\\'")
        if (!code.isNullOrBlank()) {
            pendingStopCode = null
            pendingStopName = null
            val js = """
                (function() {
                    if (window.App && typeof window.App.selectStop === 'function') {
                        window.App.switchTab('ticker');
                        window.App.selectStop('$code', '$name');
                    } else {
                        setTimeout(function() {
                            if (window.App && typeof window.App.selectStop === 'function') {
                                window.App.switchTab('ticker');
                                window.App.selectStop('$code', '$name');
                            }
                        }, 1000);
                    }
                })();
            """.trimIndent()
            webView.evaluateJavascript(js, null)
        }
    }

    fun unpinAndDismiss(stopCode: String, lineId: String) {
        runOnUiThread {
            if (this::webView.isInitialized) {
                val cleanStop = stopCode.replace("'", "\\'")
                val cleanLine = lineId.replace("'", "\\'")
                val js = """
                    (function() {
                        if (window.PinnedTrips && typeof window.PinnedTrips.removePinByStopAndLine === 'function') {
                            window.PinnedTrips.removePinByStopAndLine('$cleanStop', '$cleanLine');
                        }
                        if (window.Alarms && typeof window.Alarms.removeAlarmByStopAndLine === 'function') {
                            window.Alarms.removeAlarmByStopAndLine('$cleanStop', '$cleanLine');
                        }
                    })();
                """.trimIndent()
                webView.evaluateJavascript(js, null)
            }
        }
    }

    fun unpinAllAndDismiss() {
        runOnUiThread {
            if (this::webView.isInitialized) {
                val js = """
                    (function() {
                        if (window.PinnedTrips && typeof window.PinnedTrips.clearAllSilently === 'function') {
                            window.PinnedTrips.clearAllSilently();
                        }
                        if (window.AndroidBridge && typeof window.AndroidBridge.stopLiveTracking === 'function') {
                            try { window.AndroidBridge.stopLiveTracking(); } catch (e) {}
                        }
                    })();
                """.trimIndent()
                webView.evaluateJavascript(js, null)
            }
        }
    }

    companion object {
        const val EXTRA_STOP_CODE = "EXTRA_STOP_CODE"
        const val EXTRA_STOP_NAME = "EXTRA_STOP_NAME"
        @Volatile
        var currentInstance: MainActivity? = null
    }

    inner class WebAppInterface(private val context: Context) {

        @JavascriptInterface
        fun getMaterialYouColors(): String {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return "{}"
            return try {
                val isDark = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
                fun hex(resId: Int): String {
                    val color = ContextCompat.getColor(context, resId)
                    return String.format("#%06X", 0xFFFFFF and color)
                }

                val primary = if (isDark) hex(android.R.color.system_accent1_200) else hex(android.R.color.system_accent1_600)
                val onPrimary = if (isDark) hex(android.R.color.system_accent1_800) else "#FFFFFF"
                val primaryContainer = if (isDark) hex(android.R.color.system_accent1_700) else hex(android.R.color.system_accent1_100)
                val onPrimaryContainer = if (isDark) hex(android.R.color.system_accent1_100) else hex(android.R.color.system_accent1_900)

                val secondary = if (isDark) hex(android.R.color.system_accent2_200) else hex(android.R.color.system_accent2_600)
                val secondaryContainer = if (isDark) hex(android.R.color.system_accent2_700) else hex(android.R.color.system_accent2_100)

                val surface = if (isDark) hex(android.R.color.system_neutral1_900) else hex(android.R.color.system_neutral1_10)
                val onSurface = if (isDark) hex(android.R.color.system_neutral1_100) else hex(android.R.color.system_neutral1_900)

                val surfaceContainer = if (isDark) hex(android.R.color.system_neutral2_800) else hex(android.R.color.system_neutral2_50)
                val surfaceContainerHigh = if (isDark) hex(android.R.color.system_neutral2_700) else hex(android.R.color.system_neutral2_100)
                val surfaceContainerHighest = if (isDark) hex(android.R.color.system_neutral2_600) else hex(android.R.color.system_neutral2_200)

                val outline = hex(android.R.color.system_neutral2_400)
                val outlineVariant = hex(android.R.color.system_neutral2_200)

                JSONObject().apply {
                    put("primary", primary)
                    put("onPrimary", onPrimary)
                    put("primaryContainer", primaryContainer)
                    put("onPrimaryContainer", onPrimaryContainer)
                    put("secondary", secondary)
                    put("secondaryContainer", secondaryContainer)
                    put("surface", surface)
                    put("onSurface", onSurface)
                    put("surfaceContainer", surfaceContainer)
                    put("surfaceContainerHigh", surfaceContainerHigh)
                    put("surfaceContainerHighest", surfaceContainerHighest)
                    put("outline", outline)
                    put("outlineVariant", outlineVariant)
                    put("isDark", isDark)
                }.toString()
            } catch (e: Exception) {
                "{}"
            }
        }

        @JavascriptInterface
        fun showToast(toast: String) {
            Toast.makeText(context, toast, Toast.LENGTH_SHORT).show()
        }

        @JavascriptInterface
        fun openExternalUrl(url: String) {
            try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(intent)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        @JavascriptInterface
        fun vibrate(durationMs: Double) {
            try {
                val duration = durationMs.toLong()
                val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    vibrator.vibrate(duration)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        @JavascriptInterface
        fun scheduleAlarm(
            lineId: String,
            stopName: String,
            minutesAway: Double,
            triggerInSeconds: Double,
            ringUntilDismissed: Boolean = true,
            stopCode: String = ""
        ) {
            try {
                val mins = minutesAway.toInt()
                val trigSecs = triggerInSeconds.toLong()

                val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                val intent = Intent(context, AlarmReceiver::class.java).apply {
                    putExtra("EXTRA_LINE_ID", lineId)
                    putExtra("EXTRA_STOP_NAME", stopName)
                    putExtra("EXTRA_MINUTES_AWAY", mins)
                    putExtra("EXTRA_RING_UNTIL_DISMISSED", ringUntilDismissed)
                    putExtra("EXTRA_STOP_CODE", stopCode)
                }
                val pendingIntent = PendingIntent.getBroadcast(
                    context,
                    lineId.hashCode(),
                    intent,
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                )

                val triggerTime = System.currentTimeMillis() + (trigSecs * 1000L)

                val showIntent = Intent(context, MainActivity::class.java).apply {
                    putExtra(EXTRA_STOP_CODE, stopCode)
                    putExtra(EXTRA_STOP_NAME, stopName)
                }
                val pShow = PendingIntent.getActivity(
                    context,
                    0,
                    showIntent,
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                )

                var exactScheduled = false
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    if (alarmManager.canScheduleExactAlarms()) {
                        val alarmClockInfo = AlarmManager.AlarmClockInfo(triggerTime, pShow)
                        alarmManager.setAlarmClock(alarmClockInfo, pendingIntent)
                        exactScheduled = true
                    }
                } else {
                    val alarmClockInfo = AlarmManager.AlarmClockInfo(triggerTime, pShow)
                    alarmManager.setAlarmClock(alarmClockInfo, pendingIntent)
                    exactScheduled = true
                }

                if (!exactScheduled) {
                    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent)
                        } else {
                            alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent)
                        }
                    } else {
                        alarmManager.set(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent)
                    }
                }

                val timeFormatted = NotificationHelper.formatMinutesHuman(mins)
                val msg = if (ringUntilDismissed) {
                    "Συνεχής συναγερμός ρυθμίστηκε για το $lineId σε $timeFormatted (θα χτυπάει μέχρι να τον κλείσετε)"
                } else {
                    "Ειδοποίηση ρυθμίστηκε για το $lineId σε $timeFormatted"
                }
                Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        @JavascriptInterface
        fun startLiveTracking(
            stopCode: String,
            lineId: String,
            routeCode: String,
            stopName: String,
            destination: String,
            walkMinutes: Double,
            thresholdMinutes: Double,
            ringUntilDismissed: Boolean = false,
            initialMinutes: Double = 10.0
        ) {
            try {
                if (thresholdMinutes <= 0.0) {
                    try {
                        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                        val intent = Intent(context, AlarmReceiver::class.java)
                        val pendingIntent = PendingIntent.getBroadcast(
                            context,
                            lineId.hashCode(),
                            intent,
                            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE
                        )
                        if (pendingIntent != null) {
                            alarmManager.cancel(pendingIntent)
                            pendingIntent.cancel()
                        }
                        AlarmRingingService.dismiss(context)
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }

                LiveTrackingService.start(
                    context,
                    stopCode,
                    lineId,
                    routeCode,
                    stopName,
                    destination,
                    walkMinutes.toInt(),
                    thresholdMinutes.toInt(),
                    ringUntilDismissed,
                    initialMinutes.toInt()
                )
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        @JavascriptInterface
        fun stopLiveTracking() {
            try {
                LiveTrackingService.stop(context)
                AlarmRingingService.dismiss(context)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        @JavascriptInterface
        fun dismissAlarm() {
            try {
                AlarmRingingService.dismiss(context)
                LiveTrackingService.stop(context)
                NotificationHelper.clearLiveArrivalNotification(context)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        @JavascriptInterface
        fun updateLiveArrivalNotification(
            lineId: String,
            minutesAway: Double,
            stopName: String,
            destination: String = "",
            walkMinutes: Double = 0.0,
            stopCode: String = "",
            initialMinutes: Double = 10.0
        ) {
            try {
                NotificationHelper.updateLiveArrivalNotification(
                    context,
                    lineId,
                    minutesAway.toInt(),
                    stopName,
                    destination,
                    walkMinutes.toInt(),
                    stopCode,
                    initialMinutes.toInt()
                )
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        @JavascriptInterface
        fun clearLiveArrivalNotification() {
            try {
                NotificationHelper.clearLiveArrivalNotification(context)
                LiveTrackingService.stop(context)
                AlarmRingingService.dismiss(context)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        @JavascriptInterface
        fun isIgnoringBatteryOptimizations(): Boolean {
            return try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
                    pm.isIgnoringBatteryOptimizations(context.packageName)
                } else {
                    true
                }
            } catch (e: Exception) {
                true
            }
        }

        @JavascriptInterface
        fun requestIgnoreBatteryOptimizations() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
                    if (!pm.isIgnoringBatteryOptimizations(context.packageName)) {
                        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                            data = Uri.parse("package:${context.packageName}")
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK
                        }
                        context.startActivity(intent)
                    } else {
                        Toast.makeText(context, "Η εφαρμογή εξαιρείται ήδη από την εξοικονόμηση μπαταρίας!", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                try {
                    val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    context.startActivity(intent)
                } catch (e2: Exception) {
                    e2.printStackTrace()
                }
            }
        }

        @JavascriptInterface
        fun syncFavorites(favStopsJson: String, favLinesJson: String) {
            try {
                val prefs = context.getSharedPreferences("OASA_PERSISTENT_DATA", Context.MODE_PRIVATE)
                prefs.edit()
                    .putString("OASA_FAV_STOPS", favStopsJson)
                    .putString("OASA_FAV_LINES", favLinesJson)
                    .apply()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        @JavascriptInterface
        fun getSavedFavorites(): String {
            return try {
                val prefs = context.getSharedPreferences("OASA_PERSISTENT_DATA", Context.MODE_PRIVATE)
                val stops = prefs.getString("OASA_FAV_STOPS", "[]") ?: "[]"
                val lines = prefs.getString("OASA_FAV_LINES", "[]") ?: "[]"
                val json = JSONObject()
                json.put("stops", stops)
                json.put("lines", lines)
                json.toString()
            } catch (e: Exception) {
                "{}"
            }
        }

        @JavascriptInterface
        fun canPostPromotedNotifications(): Boolean {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            return try {
                val method = nm.javaClass.getMethod("canPostPromotedNotifications")
                method.invoke(nm) as? Boolean ?: true
            } catch (e: Throwable) {
                true
            }
        }

        @JavascriptInterface
        fun openLiveUpdatesSettings() {
            runOnUiThread {
                val intentList = listOf(
                    Intent("android.settings.APP_NOTIFICATION_PROMOTION_SETTINGS").apply {
                        putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                        putExtra("android.provider.extra.APP_PACKAGE", packageName)
                        putExtra("app_package", packageName)
                    },
                    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                        putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                        putExtra("android.provider.extra.APP_PACKAGE", packageName)
                        putExtra("app_package", packageName)
                        putExtra("app_uid", applicationInfo.uid)
                    },
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.parse("package:$packageName")
                    }
                )
                for (intent in intentList) {
                    try {
                        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                        context.startActivity(intent)
                        return@runOnUiThread
                    } catch (e: Exception) {}
                }
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        if (currentInstance === this) {
            currentInstance = null
        }
        if (this::webView.isInitialized) {
            webView.destroy()
        }
        super.onDestroy()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_CODE) {
            for (i in permissions.indices) {
                val perm = permissions[i]
                val result = grantResults[i]
                if (result != PackageManager.PERMISSION_GRANTED) {
                    if (perm == Manifest.permission.POST_NOTIFICATIONS) {
                        println("POST_NOTIFICATIONS permission denied")
                    } else if (perm == Manifest.permission.ACCESS_FINE_LOCATION || perm == Manifest.permission.ACCESS_COARSE_LOCATION) {
                        Toast.makeText(this, "Location features may be limited without permission", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }
}
