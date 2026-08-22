package com.dsh.remote

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.http.SslError
import android.os.Bundle
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import kotlin.concurrent.thread

/**
 * DSH Remote —— 一键连接 Windows 端 DeepSeek Harness。
 *
 * 流程：
 *   1. 读 SharedPreferences 里保存的公网 URL（首次弹输入框）
 *   2. 后台线程健康检查 GET /（适配免费 cpolar 的慢速首包）
 *   3. 2xx → WebView 全屏加载；失败 → 显示"连接失败"覆盖层
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val PREFS = "dsh_remote"
        private const val KEY_URL = "base_url"
        private const val HEALTH_TIMEOUT_MS = 15000
        private const val HEALTH_RETRIES = 3
        private const val HEALTH_RETRY_DELAY_MS = 1500L
        private const val LOAD_TIMEOUT_MS = 30000
    }

    private lateinit var webView: WebView
    private lateinit var overlay: android.widget.LinearLayout
    private lateinit var overlayIcon: TextView
    private lateinit var overlayTitle: TextView
    private lateinit var overlayHint: TextView
    private lateinit var btnRetry: Button
    private lateinit var btnChangeUrl: Button
    private lateinit var btnExit: TextView

    private val prefs by lazy { getSharedPreferences(PREFS, Context.MODE_PRIVATE) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        overlay = findViewById(R.id.overlay)
        overlayIcon = findViewById(R.id.overlayIcon)
        overlayTitle = findViewById(R.id.overlayTitle)
        overlayHint = findViewById(R.id.overlayHint)
        btnRetry = findViewById(R.id.btnRetry)
        btnChangeUrl = findViewById(R.id.btnChangeUrl)
        btnExit = findViewById(R.id.btnExit)

        setupWebView()
        btnRetry.setOnClickListener { connect() }
        btnChangeUrl.setOnClickListener { showUrlDialog() }
        btnExit.setOnClickListener {
            finish()
        }

        val savedUrl = prefs.getString(KEY_URL, null)
        if (savedUrl.isNullOrBlank()) {
            showUrlDialog()
        } else {
            connect()
        }
    }

    /** WebView 关键配置：JS、DOM storage、WebSocket 全开（DSH 是 SPA + WS 实时同步） */
    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(false)
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            userAgentString = userAgentString + " DSHRemote/1.0"
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                // 页面开始加载就隐藏覆盖层，避免白屏闪烁
                showWebView()
            }

            override fun onPageFinished(view: WebView, url: String?) {
                installApprovalLock(view)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                // 只处理主框架错误（子资源错误不打断页面）
                if (request?.isForMainFrame == true) {
                    showFailure()
                }
            }

            override fun onReceivedSslError(
                view: WebView?,
                handler: SslErrorHandler?,
                error: SslError?
            ) {
                // 证书错误直接判定为连接失败（不静默放行，保证安全）
                handler?.cancel()
                showFailure()
            }
        }
        webView.webChromeClient = WebChromeClient()
    }

    /** 将待审批面板锁定为手机端强制模态，只允许操作审批面板内部。 */
    private fun installApprovalLock(view: WebView) {
        val script = """
            (() => {
              if (window.__dshRemoteApprovalLockInstalled) return;
              window.__dshRemoteApprovalLockInstalled = true;

              const style = document.createElement('style');
              style.textContent = 'html[data-dsh-approval-lock] [data-approval-key] {' +
                'position:fixed!important;inset:max(16px,env(safe-area-inset-top)) 12px max(16px,env(safe-area-inset-bottom)) 12px!important;' +
                'z-index:2147483647!important;width:auto!important;max-width:none!important;max-height:none!important;margin:0!important;' +
                'overflow:auto!important;background:var(--dsw-alias-bg-base,#fff)!important;' +
                'box-shadow:0 0 0 100vmax rgba(0,0,0,.72)!important;pointer-events:auto!important;}';
              document.head.appendChild(style);

              const approval = () => document.querySelector('[data-approval-key]');
              let settleUntil = 0;
              const closeTaskBoard = () => {
                document.documentElement.removeAttribute('data-dsh-taskboard-active');
              };
              const sync = () => {
                const panel = approval();
                if (panel) {
                  closeTaskBoard();
                  document.documentElement.setAttribute('data-dsh-approval-lock', '');
                  panel.setAttribute('tabindex', '-1');
                  panel.scrollIntoView({ block: 'center', inline: 'nearest' });
                  if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
                } else {
                  document.documentElement.removeAttribute('data-dsh-approval-lock');
                  if (Date.now() < settleUntil) closeTaskBoard();
                }
              };

              const blockOutside = (event) => {
                const panel = approval();
                const settling = Date.now() < settleUntil;
                if (panel && panel.contains(event.target)) {
                  if (event.type === 'pointerdown' || event.type === 'touchstart' || event.type === 'mousedown') {
                    settleUntil = Date.now() + 1200;
                    setTimeout(closeTaskBoard, 0);
                    setTimeout(closeTaskBoard, 100);
                    setTimeout(closeTaskBoard, 350);
                    setTimeout(closeTaskBoard, 800);
                  }
                  return;
                }
                if (!panel && !settling) return;
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                closeTaskBoard();
                if (panel) panel.scrollIntoView({ block: 'center', inline: 'nearest' });
              };
              ['pointerdown', 'mousedown', 'touchstart', 'click'].forEach(type =>
                document.addEventListener(type, blockOutside, true));
              document.addEventListener('keydown', event => {
                if (approval() && event.key === 'Escape') blockOutside(event);
              }, true);

              new MutationObserver(sync).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-dsh-taskboard-active'] });
              setInterval(() => {
                if (approval() || Date.now() < settleUntil) closeTaskBoard();
              }, 100);
              sync();
            })();
        """.trimIndent()
        view.evaluateJavascript(script, null)
    }

    /** 读取 URL 并开始连接 */
    private fun connect() {
        val url = prefs.getString(KEY_URL, null)
        if (url.isNullOrBlank()) {
            showUrlDialog()
            return
        }
        val normalized = normalizeUrl(url)
        prefs.edit().putString(KEY_URL, normalized).apply()

        // 先做网络可达性 + 健康检查，再决定加载还是报错
        showConnecting()
        thread {
            val result = healthCheck(normalized)
            runOnUiThread {
                when (result) {
                    is HealthResult.Ok -> {
                        webView.loadUrl(normalized)
                        // loadUrl 后 onPageStarted 会切到 WebView；这里保险起见也切一次
                        showWebView()
                    }
                    is HealthResult.Fail -> showFailure(result.reason)
                }
            }
        }
    }

    /** 健康检查：启动期间等待代理恢复，连续失败后才返回错误。 */
    private fun healthCheck(baseUrl: String): HealthResult {
        if (!isNetworkAvailable()) {
            return HealthResult.Fail("手机无网络连接")
        }

        var lastFailure = "无法连接 Windows 端"
        repeat(HEALTH_RETRIES) { attempt ->
            try {
                val conn = java.net.URL(baseUrl).openConnection() as java.net.HttpURLConnection
                conn.connectTimeout = HEALTH_TIMEOUT_MS
                conn.readTimeout = HEALTH_TIMEOUT_MS
                conn.instanceFollowRedirects = true
                conn.setRequestProperty("User-Agent", "DSHRemote/1.0 health-check")
                val code = conn.responseCode
                try { conn.inputStream?.close() } catch (_: Exception) {}
                conn.disconnect()

                when {
                    code in 200..299 -> return HealthResult.Ok
                    code == 502 || code == 503 -> lastFailure = "Windows 端正在启动"
                    code == 404 -> return HealthResult.Fail("公网地址已失效，请更新地址")
                    else -> return HealthResult.Fail("连接失败（HTTP $code）")
                }
            } catch (e: java.net.SocketTimeoutException) {
                lastFailure = "公网连接超时，请重试"
            } catch (e: Exception) {
                lastFailure = "无法连接公网地址"
            }
            if (attempt + 1 < HEALTH_RETRIES) {
                Thread.sleep(HEALTH_RETRY_DELAY_MS)
            }
        }
        return HealthResult.Fail(lastFailure)
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val net = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(net) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun normalizeUrl(raw: String): String {
        var s = raw.trim()
        if (s.isEmpty()) return s
        if (!s.startsWith("http://") && !s.startsWith("https://")) {
            s = "https://" + s
        }
        return s.trimEnd('/')
    }

    // ---------- UI 状态 ----------

    private fun showConnecting() {
        webView.visibility = android.view.View.GONE
        btnExit.visibility = android.view.View.GONE
        overlay.visibility = android.view.View.VISIBLE
        overlayIcon.text = "⏳"
        overlayTitle.text = getString(R.string.connecting)
        overlayHint.visibility = android.view.View.GONE
        btnRetry.visibility = android.view.View.GONE
        btnChangeUrl.visibility = android.view.View.GONE
    }

    private fun showWebView() {
        webView.visibility = android.view.View.VISIBLE
        btnExit.visibility = android.view.View.VISIBLE
        overlay.visibility = android.view.View.GONE
    }

    private fun showFailure(reason: String = getString(R.string.connect_failed)) {
        webView.visibility = android.view.View.GONE
        btnExit.visibility = android.view.View.GONE
        overlay.visibility = android.view.View.VISIBLE
        overlayIcon.text = "❌"
        overlayTitle.text = reason
        overlayHint.visibility = android.view.View.VISIBLE
        btnRetry.visibility = android.view.View.VISIBLE
        btnChangeUrl.visibility = android.view.View.VISIBLE
    }

    private fun showUrlDialog() {
        val input = EditText(this)
        input.hint = getString(R.string.url_placeholder)
        val current = prefs.getString(KEY_URL, null)
        if (!current.isNullOrBlank()) {
            input.setText(current)
        }
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.url_prompt))
            .setView(input)
            .setPositiveButton(getString(R.string.ok)) { _, _ ->
                val url = input.text.toString().trim()
                if (url.isBlank()) {
                    Toast.makeText(this, "地址不能为空", Toast.LENGTH_SHORT).show()
                    showUrlDialog()
                } else {
                    prefs.edit().putString(KEY_URL, url).apply()
                    connect()
                }
            }
            .setNegativeButton(getString(R.string.cancel)) { d, _ ->
                d.dismiss()
                // 取消且没有已存 URL → 保持失败态
                if (prefs.getString(KEY_URL, null).isNullOrBlank()) {
                    showFailure()
                }
            }
            .setCancelable(false)
            .show()
    }

    override fun onBackPressed() {
        webView.evaluateJavascript("Boolean(document.querySelector('[data-approval-key]'))") { locked ->
            if (locked == "true") return@evaluateJavascript
            if (webView.canGoBack()) {
                webView.goBack()
            } else {
                super.onBackPressed()
            }
        }
    }
}

sealed class HealthResult {
    object Ok : HealthResult()
    data class Fail(val reason: String) : HealthResult()
}
