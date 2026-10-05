package app.swet102.link

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
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

        Events("onState", "onTelemetry", "onTrip", "onLog")

        OnStartObserving {
            Bus.listener = object : Bus.Listener {
                override fun onEvent(name: String, body: Map<String, Any?>) = sendEvent(name, body)
            }
        }
        OnStopObserving { Bus.listener = null }

        Function("getSnapshot") { Bus.snapshot() }

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
        AsyncFunction("pair") { timeoutMs: Int, promise: Promise -> scan(timeoutMs, promise) }

        Function("forget") {
            SwetLinkService.stop(context)
            Settings(context).apply {
                enabled = false
                address = null
            }
        }

        Function("start") {
            Settings(context).enabled = true
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

        Function("rebootToDfu") { SwetLinkService.instance?.rebootToDfu() ?: false }
    }

    private fun scan(timeoutMs: Int, promise: Promise) {
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
        val scanner = adapter?.takeIf { it.isEnabled }?.bluetoothLeScanner
            ?: return promise.resolve(null)
        val main = Handler(Looper.getMainLooper())
        var done = false
        lateinit var callback: ScanCallback
        val finish = { address: String? ->
            if (!done) {
                done = true
                scanner.stopScan(callback)
                if (address != null) Settings(context).address = address
                promise.resolve(address)
            }
        }
        callback = object : ScanCallback() {
            override fun onScanResult(type: Int, result: ScanResult) {
                main.post { finish(result.device.address) }
            }

            override fun onScanFailed(errorCode: Int) {
                main.post { finish(null) }
            }
        }
        val filter = ScanFilter.Builder().setDeviceName(Protocol.DEVICE_NAME).build()
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        scanner.startScan(listOf(filter), settings, callback)
        main.postDelayed({ finish(null) }, timeoutMs.toLong())
    }
}
