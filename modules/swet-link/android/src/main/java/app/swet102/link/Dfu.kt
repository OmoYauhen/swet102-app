package app.swet102.link

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import no.nordicsemi.android.dfu.DfuProgressListener
import no.nordicsemi.android.dfu.DfuServiceController
import no.nordicsemi.android.dfu.DfuServiceInitiator
import no.nordicsemi.android.dfu.DfuServiceListenerHelper

/**
 * One firmware update at a time: starts [DfuService], turns the library's
 * progress callbacks into `onDfu` events, and keeps [SwetLinkService] off the
 * display until the update has ended one way or another.
 *
 * Events: `{stage, percent?, error?, errorType?}` with stage one of
 * connecting, starting, uploading, validating, disconnecting (in progress) and
 * completed, aborted, error (final).
 */
object Dfu {
    private val main = Handler(Looper.getMainLooper())
    private var controller: DfuServiceController? = null
    /** Application context while an update runs (listener registered on it). */
    private var app: Context? = null
    private var fwVersion: Long = 0

    /** The latest event of the running (or last) update, for a UI that opens late. */
    @Volatile var last: Map<String, Any?>? = null
        private set

    @Volatile var running = false
        private set

    @Synchronized
    fun start(context: Context, address: String, uri: Uri, info: Firmware.Info) {
        check(!running) { "An update is already running" }
        val app = context.applicationContext
        running = true
        fwVersion = info.init.fwVersion
        emit(mapOf("stage" to "connecting"))
        // Before the DFU service connects: the link's autoConnect must not take
        // the bootloader's only connection.
        SwetLinkService.pauseForDfu()
        try {
            if (Build.VERSION.SDK_INT >= 26) DfuServiceInitiator.createDfuNotificationChannel(app)
            DfuServiceListenerHelper.registerProgressListener(app, listener)
            this.app = app
            controller = DfuServiceInitiator(address)
                .setDeviceName(Protocol.DFU_NAME)
                .setZip(uri)
                .setForeground(true)
                // No bonding: the display uses SEC_OPEN and the bootloader keeps none.
                .setKeepBond(false)
                // The display enters DFU by hand (M + PWR); never try the SDK 12
                // "experimental buttonless" service, which has no security at all.
                .setUnsafeExperimentalButtonlessServiceInSecureDfuEnabled(false)
                // As in the nRF Toolbox run that talked to this bootloader: PRN off.
                // The library re-enables PRN by itself if it sees lost packets.
                .setPacketsReceiptNotificationsEnabled(false)
                // MTU: left at the library's default request. S130 / SDK 12 answers
                // 23 (as in the Toolbox log), so packets stay 20 bytes either way.
                // The bootloader erases flash for each 4 KB data object when it's
                // created, and on S130 flash operations wait for gaps between radio
                // events. With PRN off nothing paces us, so wait before streaming
                // each object. Nordic found 300-400 ms enough (SDK 15/16); nobody
                // measured SDK 12 on nRF51, so take the top of that range. ~30
                // objects for a full 115 KB app cost ~12 s; a lost packet would
                // instead make the library fall back to PRN = 1, which is far slower.
                .setPrepareDataObjectDelay(400)
                // Retry (and resume the current object) after an unexpected
                // disconnect; errors reported by the bootloader are never retried.
                .setNumberOfRetries(2)
                .start(app, DfuService::class.java)
        } catch (e: Exception) {
            finish(mapOf("stage" to "error", "error" to (e.message ?: e.javaClass.simpleName), "errorType" to "other"))
            throw e
        }
    }

    @Synchronized
    fun abort() {
        val c = controller
        if (c != null) c.abort() else finish(mapOf("stage" to "aborted"))
    }

    private fun emit(e: Map<String, Any?>) {
        last = e
        Bus.emit("onDfu", e)
    }

    /** The update has ended: tidy up and give the display back to the link. */
    @Synchronized
    private fun finish(e: Map<String, Any?>) {
        if (!running) return
        running = false
        controller = null
        app?.let { context ->
            DfuServiceListenerHelper.unregisterProgressListener(context, listener)
            if (e["stage"] == "completed") {
                // The bootloader validated and activated it: that's the display's
                // build now (the version string is read again on the next connect).
                Settings(context).apply {
                    displayBuild = fwVersion.toString()
                    displayVersion = null
                }
            }
        }
        app = null
        emit(e)
        SwetLinkService.resumeAfterDfu()
    }

    private val listener = object : DfuProgressListener {
        private fun stage(s: String) = main.post { if (running) emit(mapOf("stage" to s)) }

        override fun onDeviceConnecting(deviceAddress: String) { stage("connecting") }
        override fun onDeviceConnected(deviceAddress: String) { stage("starting") }
        override fun onDfuProcessStarting(deviceAddress: String) { stage("starting") }
        override fun onDfuProcessStarted(deviceAddress: String) {
            main.post { if (running) emit(mapOf("stage" to "uploading", "percent" to 0)) }
        }
        override fun onEnablingDfuMode(deviceAddress: String) { stage("starting") }
        override fun onProgressChanged(
            deviceAddress: String,
            percent: Int,
            speed: Float,
            avgSpeed: Float,
            currentPart: Int,
            partsTotal: Int,
        ) {
            main.post { if (running) emit(mapOf("stage" to "uploading", "percent" to percent)) }
        }
        override fun onFirmwareValidating(deviceAddress: String) { stage("validating") }
        override fun onDeviceDisconnecting(deviceAddress: String?) {
            main.post { if (running && last?.get("stage") != "validating") emit(mapOf("stage" to "disconnecting")) }
        }
        override fun onDeviceDisconnected(deviceAddress: String) {}
        override fun onDfuCompleted(deviceAddress: String) {
            main.post { finish(mapOf("stage" to "completed", "percent" to 100)) }
        }
        override fun onDfuAborted(deviceAddress: String) {
            main.post { finish(mapOf("stage" to "aborted")) }
        }
        override fun onError(deviceAddress: String, error: Int, errorType: Int, message: String?) {
            val type = when (errorType) {
                1, 2 -> "communication" // ERROR_TYPE_COMMUNICATION_STATE, _COMMUNICATION
                3 -> "remote" // ERROR_TYPE_DFU_REMOTE: the bootloader said no
                else -> "other"
            }
            main.post { finish(mapOf("stage" to "error", "error" to (message ?: "error $error"), "errorType" to type)) }
        }
    }
}
