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
import androidx.activity.ComponentActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.maps.MapsInitializer

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private val PERMISSION_REQUEST_CODE = 1001

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Mandatory Google Maps Platform attribution as required by Google Maps SDK
        try {
            MapsInitializer.initialize(applicationContext, MapsInitializer.Renderer.LATEST) { renderer ->
                // Renderer initialized
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        // Notification channel setup
        NotificationHelper.createNotificationChannel(this)

        // Request runtime permissions
        requestRequiredPermissions()

        // Initialize WebView
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

        // Enable Geolocation prompt handling in WebView
        webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                callback?.invoke(origin, true, false)
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                return false
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
        }

        // Native Android Bridge for web interaction
        webView.addJavascriptInterface(WebAppInterface(this), "AndroidBridge")

        // Load live production Cloudflare Pages or bundled offline fallback
        webView.loadUrl("https://bustop.pages.dev")
    }

    inner class WebAppInterface(private val context: Context) {

        @JavascriptInterface
        fun showToast(toast: String) {
            Toast.makeText(context, toast, Toast.LENGTH_SHORT).show()
        }

        @JavascriptInterface
        fun vibrate(durationMs: Long) {
            val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(durationMs)
            }
        }

        @JavascriptInterface
        fun scheduleAlarm(lineId: String, stopName: String, minutesAway: Int, triggerInSeconds: Long) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, AlarmReceiver::class.java).apply {
                putExtra("EXTRA_LINE_ID", lineId)
                putExtra("EXTRA_STOP_NAME", stopName)
                putExtra("EXTRA_MINUTES_AWAY", minutesAway)
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                lineId.hashCode(),
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )

            val triggerTime = System.currentTimeMillis() + (triggerInSeconds * 1000)

            // setAlarmClock guarantees OS wakeup even in deep sleep (Doze) or when screen is locked
            val showIntent = Intent(context, MainActivity::class.java)
            val pShow = PendingIntent.getActivity(context, 0, showIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val alarmClockInfo = AlarmManager.AlarmClockInfo(triggerTime, pShow)
            alarmManager.setAlarmClock(alarmClockInfo, pendingIntent)

            Toast.makeText(context, "Ειδοποίηση ρυθμίστηκε για το $lineId σε $minutesAway λεπτά (λειτουργεί και με κλειστή οθόνη)", Toast.LENGTH_LONG).show()
        }

        @JavascriptInterface
        fun startLiveTracking(stopCode: String, lineId: String, routeCode: String, stopName: String, thresholdMinutes: Int) {
            LiveTrackingService.start(context, stopCode, lineId, routeCode, stopName, thresholdMinutes)
        }

        @JavascriptInterface
        fun stopLiveTracking() {
            LiveTrackingService.stop(context)
        }

        @JavascriptInterface
        fun updateLiveArrivalNotification(lineId: String, minutesAway: Int, stopName: String) {
            NotificationHelper.updateLiveArrivalNotification(context, lineId, minutesAway, stopName)
        }

        @JavascriptInterface
        fun clearLiveArrivalNotification() {
            NotificationHelper.clearLiveArrivalNotification(context)
            LiveTrackingService.stop(context)
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
}
