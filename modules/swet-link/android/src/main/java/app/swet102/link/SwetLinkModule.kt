package app.swet102.link

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.view.WindowManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS face of the link. The UI configures and watches; the work happens in
 * [SwetLinkService], which keeps running when the UI is gone.
 */
@SuppressLint("MissingPermission") // JS asks for the Bluetooth permissions first
class SwetLinkModule : Module() {
    private val context: Context
        get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

    override fun definition() = ModuleDefinition {
        Name("SwetLink")

        Events("onState", "onTelemetry", "onTrip", "onLog", "onDfu")

        OnStartObserving {
            Bus.listener = object : Bus.Listener {
                override fun onEvent(name: String, body: Map<String, Any?>) = sendEvent(name, body)
            }
        }
        OnStopObserving { Bus.listener = null }

        // The ride screen is a dashboard: keep the phone's screen on while the
        // app is in front. The flag only applies while the activity is visible.
        OnActivityEntersForeground {
            appContext.currentActivity?.let { a ->
                a.runOnUiThread { a.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
            }
        }

        Function("getSnapshot") {
            Bus.restore(context)
            Bus.snapshot()
        }

        Function("getSettings") {
            val s = Settings(context)
            val a = s.gate('A')
            val b = s.gate('B')
            mapOf(
                "address" to s.address,
                "enabled" to s.enabled,
                "haUrl" to s.haUrl,
                "haToken" to s.haToken,
                "gateAService" to a.service,
                "gateAEntity" to a.entityId,
                "gateBService" to b.service,
                "gateBEntity" to b.entityId,
                "displayBuild" to s.displayBuild,
                "displayVersion" to s.displayVersion,
            )
        }

        Function("saveHomeAssistant") { url: String, token: String, aService: String, aEntity: String,
                                         bService: String, bEntity: String ->
            val s = Settings(context)
            s.haUrl = url.trim()
            s.haToken = token.trim()
            s.setGate('A', HomeAssistant.Gate(aService.trim(), aEntity.trim()))
            s.setGate('B', HomeAssistant.Gate(bService.trim(), bEntity.trim()))
        }

        /** Find the display by name (first run only) and remember its address. */
        AsyncFunction("pair") { timeoutMs: Int, promise: Promise ->
            scan(Protocol.DEVICE_NAME, timeoutMs) { r ->
                val address = r?.device?.address
                if (address != null) Settings(context).address = address
                promise.resolve(address)
            }
        }

        Function("forget") {
            SwetLinkService.stop(context)
            Settings(context).apply {
                enabled = false
                address = null
            }
        }

        Function("start") {
            Settings(context).enabled = true
            // While the UI is in front: cache the location for the service's sun times.
            Place.current(context, Settings(context))
            SwetLinkService.start(context)
        }

        Function("stop") {
            Settings(context).enabled = false
            SwetLinkService.stop(context)
        }

        /** Same path as a press on the Gate page; resolves with null or the error. */
        AsyncFunction("testGate") { which: String, promise: Promise ->
            val service = SwetLinkService.instance
            if (service == null) {
                promise.resolve("the link is off")
            } else {
                service.openGate(if (which == "B") 'B' else 'A') { promise.resolve(it) }
            }
        }

        // ---- firmware update (OTA tab) ----

        /** Check a DFU zip; rejects with a readable reason if it can't go to the display. */
        AsyncFunction("inspectFirmware") { uri: String ->
            val (info, size) = inspect(Uri.parse(uri))
            mapOf(
                "name" to displayName(Uri.parse(uri)),
                "size" to size.toDouble(),
                "fwVersion" to info.init.fwVersion.toDouble(),
                "hwVersion" to info.init.hwVersion.toDouble(),
                "sdReq" to info.init.sdReq.map { it.toDouble() },
                "appSize" to info.binSize.toDouble(),
                "type" to "application",
                "signed" to info.init.signed,
            )
        }

        /** Look for the bootloader (SW102_DFU); null if it doesn't show up in time. */
        AsyncFunction("scanDfu") { timeoutMs: Int, promise: Promise ->
            scan(Protocol.DFU_NAME, timeoutMs) { r ->
                promise.resolve(r?.let { mapOf("address" to it.device.address, "rssi" to it.rssi) })
            }
        }

        /** Start the update; progress comes as onDfu events. Pauses the link meanwhile. */
        Function("startDfu") { address: String, uri: String ->
            val u = Uri.parse(uri)
            val (info, _) = inspect(u)
            Dfu.start(context, address, u, info)
        }

        Function("abortDfu") { Dfu.abort() }

        /** The latest onDfu event and whether an update is running, for a UI that opens late. */
        Function("getDfu") { mapOf("running" to Dfu.running, "last" to Dfu.last) }
    }

    private fun inspect(uri: Uri): Pair<Firmware.Info, Long> {
        val input = try {
            context.contentResolver.openInputStream(uri)
        } catch (e: Exception) {
            null
        } ?: throw CodedException("ERR_FIRMWARE", "Can't open the file", null)
        val counting = object : java.io.FilterInputStream(input) {
            var count = 0L
            override fun read(): Int = super.read().also { if (it >= 0) count++ }
            override fun read(b: ByteArray, off: Int, len: Int): Int =
                super.read(b, off, len).also { if (it > 0) count += it }
        }
        return try {
            val info = counting.use { Firmware.inspectZip(it) }
            info to counting.count
        } catch (e: Firmware.Invalid) {
            throw CodedException("ERR_FIRMWARE", e.message, null)
        }
    }

    private fun displayName(uri: Uri): String {
        if (uri.scheme == "content") {
            runCatching {
                context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                    if (c.moveToFirst()) return c.getString(0)
                }
            }
        }
        return uri.lastPathSegment ?: uri.toString()
    }

    /** First advertiser named [name] within [timeoutMs], or null. */
    private fun scan(name: String, timeoutMs: Int, done: (ScanResult?) -> Unit) {
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
        val scanner = adapter?.takeIf { it.isEnabled }?.bluetoothLeScanner
            ?: return done(null)
        val main = Handler(Looper.getMainLooper())
        var finished = false
        lateinit var callback: ScanCallback
        val finish = { result: ScanResult? ->
            if (!finished) {
                finished = true
                runCatching { scanner.stopScan(callback) }
                done(result)
            }
        }
        callback = object : ScanCallback() {
            override fun onScanResult(type: Int, result: ScanResult) {
                main.post { finish(result) }
            }

            override fun onScanFailed(errorCode: Int) {
                main.post { finish(null) }
            }
        }
        val filter = ScanFilter.Builder().setDeviceName(name).build()
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        scanner.startScan(listOf(filter), settings, callback)
        main.postDelayed({ finish(null) }, timeoutMs.toLong())
    }
}
