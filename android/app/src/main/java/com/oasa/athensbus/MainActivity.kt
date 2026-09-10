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

        webView.addJavascriptInterface(WebAppInterface(this), "AndroidBridge")
        webView.loadUrl("https://bustop.pages.dev")
    }

    inner class WebAppInterface(private val context: Context) {

        @JavascriptInterface
        fun showToast(toast: String) {
            Toast.makeText(context, toast, Toast.LENGTH_SHORT).show()
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
            ringUntilDismissed: Boolean = true
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
                }
                val pendingIntent = PendingIntent.getBroadcast(
                    context,
                    lineId.hashCode(),
                    intent,
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                )

                val triggerTime = System.currentTimeMillis() + (trigSecs * 1000L)

                val showIntent = Intent(context, MainActivity::class.java)
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
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent)
                    } else {
                        alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent)
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
            ringUntilDismissed: Boolean = true,
            initialMinutes: Double = 10.0
        ) {
            try {
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
            walkMinutes: Double = 0.0
        ) {
            try {
                NotificationHelper.updateLiveArrivalNotification(
                    context,
                    lineId,
                    minutesAway.toInt(),
                    stopName,
                    destination,
                    walkMinutes.toInt()
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
