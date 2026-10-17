package app.swet102.link

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.view.KeyEvent
import java.util.concurrent.Executors

/**
 * Keeps the phone connected to the display and acts on its commands, with the
 * screen off and the app closed (swet102 PRODUCT §9 "Companion app requirements").
 *
 * - Foreground service (connectedDevice), restarted at boot when enabled.
 * - `connectGatt(address, autoConnect = true)`: the Bluetooth stack connects in
 *   the background whenever the display shows up; no scanning after first setup.
 * - On every connect, read the firmware build and version from Device
 *   Information (saved for the OTA tab), then subscribe to command, telemetry
 *   and trips again (no bonding, so the display keeps no subscriptions).
 * - While a firmware update runs ([pauseForDfu]) the link lets go of the
 *   display: the bootloader takes a single connection, and autoConnect would
 *   grab it.
 * - Commands: volume and media keys locally, gates through Home Assistant.
 * - Battery: state of charge and pack voltage from telemetry go to Home
 *   Assistant's input_number helpers, throttled ([BATTERY_REPORT_MS]), on
 *   their own HTTP thread so a slow HA never delays a gate.
 * - Time sync: the display has no clock, so once the link is up and then
 *   every [TIME_SYNC_MS] we write the local time and today's sunset/sunrise
 *   to the control characteristic (for its Lights AUTO mode).
 *
 * All GATT work runs on one handler thread; Android allows one GATT operation
 * at a time, so the DIS reads and CCCD writes are chained through their callbacks.
 */
@SuppressLint("MissingPermission") // the UI starts us only once BLUETOOTH_CONNECT is granted
class SwetLinkService : Service() {
    companion object {
        private const val CHANNEL = "link"
        private const val NOTIFICATION_ID = 1
        private const val RECONNECT_DELAY_MS = 1000L
        private const val TIME_SYNC_MS = 10 * 60 * 1000L
        /** At most one battery value per helper this often (plus one on connect). */
        private const val BATTERY_REPORT_MS = 60_000L
        /** How long to leave the display alone when we find its bootloader instead. */
        private const val BOOTLOADER_BACKOFF_MS = 30_000L

        @Volatile var instance: SwetLinkService? = null
            private set

        /** A firmware update owns the display; don't connect. In memory only. */
        @Volatile var paused = false
            private set

        /** Close the GATT and stay off the display until [resumeAfterDfu]. */
        fun pauseForDfu() {
            paused = true
            instance?.let { s -> s.handler.post { s.release("paused", "Paused for a firmware update") } }
        }

        fun resumeAfterDfu() {
            paused = false
            instance?.let { s -> s.handler.post { s.connect() } }
        }

        fun start(context: Context) {
            context.startForegroundService(Intent(context, SwetLinkService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, SwetLinkService::class.java))
        }
    }

    private lateinit var settings: Settings
    private lateinit var actions: Actions
    private val thread = HandlerThread("swet-link").apply { start() }
    private val handler = Handler(thread.looper)
    private val http = Executors.newSingleThreadExecutor()
    private val dedup = Protocol.Dedup()
    private val batteryHttp = Executors.newSingleThreadExecutor()
    private val socReport = HomeAssistant.Throttle(BATTERY_REPORT_MS, 1.0)
    private val voltageReport = HomeAssistant.Throttle(BATTERY_REPORT_MS, 0.1)
    /** Last battery push error (batteryHttp thread), so a dead HA is logged once. */
    private var batteryError: String? = null

    private var gatt: BluetoothGatt? = null
    private var pendingReads = ArrayDeque<BluetoothGattCharacteristic>()
    /** DIS values of this connection; null for "absent", missing key for "read failed". */
    private var displayInfo: HashMap<java.util.UUID, String?>? = null
    private var pendingCccds = ArrayDeque<BluetoothGattDescriptor>()
    private var stopping = false
    /** Services discovered and subscriptions done. */
    private var linkUp = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        Bus.restore(this)
        settings = Settings(this)
        actions = Actions(this)
        createChannel()
        val notification = notification("Waiting for the display")
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        registerReceiver(adapterState, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED))
        handler.post { connect() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        stopping = true
        unregisterReceiver(adapterState)
        handler.post {
            linkDown()
            gatt?.disconnect()
            gatt?.close()
            gatt = null
            thread.quitSafely()
        }
        http.shutdown()
        batteryHttp.shutdown()
        instance = null
        Bus.state("off")
        super.onDestroy()
    }

    // ---- connection ----

    private fun adapter(): BluetoothAdapter? =
        (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter

    private fun connect() {
        if (stopping || gatt != null) return
        if (paused) return setState("paused", "Paused for a firmware update")
        val address = settings.address
        val adapter = adapter()
        when {
            address == null -> return setState("no display paired", "Pair a display in the app")
            adapter == null || !adapter.isEnabled -> return setState("bluetooth off", "Bluetooth is off")
        }
        val device: BluetoothDevice = adapter!!.getRemoteDevice(address)
        setState("waiting", "Waiting for the display")
        gatt = device.connectGatt(this, true, callback, BluetoothDevice.TRANSPORT_LE)
    }

    /** Drop this GATT and arm a fresh background connection. */
    private fun reconnect() {
        linkDown()
        gatt?.close()
        gatt = null
        if (!stopping) handler.postDelayed({ connect() }, RECONNECT_DELAY_MS)
    }

    /** Let go of the display now; nothing re-arms the connection by itself. */
    private fun release(state: String, text: String) {
        linkDown()
        gatt?.disconnect()
        gatt?.close()
        gatt = null
        setState(state, text)
    }

    private val adapterState = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1)) {
                BluetoothAdapter.STATE_ON -> handler.post { connect() }
                BluetoothAdapter.STATE_OFF -> handler.post {
                    linkDown()
                    gatt?.close()
                    gatt = null
                    setState("bluetooth off", "Bluetooth is off")
                }
            }
        }
    }

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            handler.post {
                if (g != gatt) return@post
                when (newState) {
                    BluetoothProfile.STATE_CONNECTED -> {
                        setState("connecting", "Connecting to the display")
                        dedup.reset()
                        g.discoverServices()
                    }
                    BluetoothProfile.STATE_DISCONNECTED -> reconnect()
                }
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            handler.post {
                if (g != gatt) return@post
                val service = g.getService(Protocol.SERVICE)
                if (status == BluetoothGatt.GATT_SUCCESS && service == null && g.getService(Protocol.SECURE_DFU) != null) {
                    // The display is in its bootloader (SW102_DFU) and kept the app's
                    // address. It takes one connection and stops advertising while
                    // connected, so holding it would hide it from the OTA tab: back off.
                    release("waiting", "The display is in its bootloader")
                    handler.postDelayed({ connect() }, BOOTLOADER_BACKOFF_MS)
                    return@post
                }
                if (status != BluetoothGatt.GATT_SUCCESS || service == null) {
                    // Not a Swet102 display (or a stale cache): start over.
                    g.disconnect()
                    return@post
                }
                // Firmware build/version first (missing characteristic: skipped),
                // then the subscriptions; one GATT operation at a time.
                val dis = g.getService(Protocol.DIS)
                val reads = listOf(Protocol.DIS_SOFTWARE_REV, Protocol.DIS_FIRMWARE_REV)
                displayInfo = dis?.let { d ->
                    // absent on older firmware: that firmware has no build to report
                    HashMap<java.util.UUID, String?>().apply {
                        reads.forEach { if (d.getCharacteristic(it) == null) put(it, null) }
                    }
                }
                pendingReads = ArrayDeque(reads.mapNotNull { dis?.getCharacteristic(it) })
                pendingCccds = ArrayDeque(
                    Protocol.NOTIFY.mapNotNull { uuid ->
                        service.getCharacteristic(uuid)?.let { c ->
                            g.setCharacteristicNotification(c, true)
                            c.getDescriptor(Protocol.CCCD)
                        }
                    },
                )
                nextSetupStep(g)
            }
        }

        // API 33+
        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
            val copy = value.copyOf()
            handler.post { onRead(g, c.uuid, copy, status) }
        }

        // API < 33
        @Deprecated("Deprecated in Java")
        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            @Suppress("DEPRECATION")
            val copy = c.value?.copyOf() ?: ByteArray(0)
            handler.post { onRead(g, c.uuid, copy, status) }
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            handler.post { if (g == gatt) writeNextCccd(g) }
        }

        // API 33+
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
            val copy = value.copyOf()
            handler.post { onValue(c.uuid, copy) }
        }

        // API < 33
        @Deprecated("Deprecated in Java")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            @Suppress("DEPRECATION")
            val copy = c.value?.copyOf() ?: return
            handler.post { onValue(c.uuid, copy) }
        }
    }

    private fun onRead(g: BluetoothGatt, uuid: java.util.UUID, value: ByteArray, status: Int) {
        if (g != gatt) return
        if (status == BluetoothGatt.GATT_SUCCESS) {
            displayInfo?.put(uuid, String(value, Charsets.UTF_8).trim { it <= ' ' || it == '\u0000' })
        }
        nextSetupStep(g)
    }

    /** Next DIS read, or (when they're done) save what we learnt and subscribe. */
    private fun nextSetupStep(g: BluetoothGatt) {
        while (true) {
            val c = pendingReads.removeFirstOrNull() ?: break
            if (g.readCharacteristic(c)) return // continues in onCharacteristicRead
        }
        displayInfo?.let { info ->
            if (info.containsKey(Protocol.DIS_SOFTWARE_REV)) settings.displayBuild = info[Protocol.DIS_SOFTWARE_REV]
            if (info.containsKey(Protocol.DIS_FIRMWARE_REV)) settings.displayVersion = info[Protocol.DIS_FIRMWARE_REV]
        }
        displayInfo = null
        writeNextCccd(g)
    }

    private fun writeNextCccd(g: BluetoothGatt) {
        val d = pendingCccds.removeFirstOrNull()
        if (d == null) {
            setState("connected", "Connected to the display")
            linkUp = true
            socReport.reset()
            voltageReport.reset()
            syncTime()
            return
        }
        val on = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        if (Build.VERSION.SDK_INT >= 33) {
            g.writeDescriptor(d, on)
        } else {
            @Suppress("DEPRECATION")
            d.value = on
            @Suppress("DEPRECATION")
            g.writeDescriptor(d)
        }
    }

    // ---- what the display sends ----

    private fun onValue(uuid: java.util.UUID, value: ByteArray) {
        when (uuid) {
            Protocol.TELEMETRY -> {
                Bus.telemetry(value.toHex())
                reportBattery(value)
            }
            Protocol.TRIPS -> if (value.size >= 2) Bus.trip(value[1].toInt() and 0xFF, value.toHex())
            Protocol.COMMAND -> {
                val p = Protocol.parseCommand(value) ?: return
                if (dedup.accept(p)) act(p.command)
            }
        }
    }

    private fun act(c: Protocol.Command) {
        when (c) {
            Protocol.Command.VOLUME_UP -> actions.volume(up = true)
            Protocol.Command.VOLUME_DOWN -> actions.volume(up = false)
            Protocol.Command.NEXT_TRACK -> actions.mediaKey(KeyEvent.KEYCODE_MEDIA_NEXT)
            Protocol.Command.PREV_TRACK -> actions.mediaKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS)
            Protocol.Command.PLAY_PAUSE -> actions.mediaKey(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
            Protocol.Command.GATE_A -> return openGate('A')
            Protocol.Command.GATE_B -> return openGate('B')
        }
        Bus.log("command", label(c), true)
    }

    private fun label(c: Protocol.Command) = when (c) {
        Protocol.Command.VOLUME_UP -> "Volume +"
        Protocol.Command.VOLUME_DOWN -> "Volume −"
        Protocol.Command.NEXT_TRACK -> "Next track"
        Protocol.Command.PREV_TRACK -> "Previous track"
        Protocol.Command.PLAY_PAUSE -> "Play / pause"
        Protocol.Command.GATE_A -> "Gate A"
        Protocol.Command.GATE_B -> "Gate B"
    }

    /** Fire the Home Assistant call off the GATT thread; buzz with the result. */
    fun openGate(which: Char, done: ((String?) -> Unit)? = null) {
        val (req, problem) = HomeAssistant.request(settings.haUrl, settings.haToken, settings.gate(which))
        http.execute {
            val error = problem ?: when (val r = HomeAssistant.send(req!!)) {
                HomeAssistant.Result.Ok -> null
                is HomeAssistant.Result.Failed -> r.reason
            }
            actions.buzz(error == null)
            Bus.log("gate", if (error == null) "Gate $which" else "Gate $which: $error", error == null)
            done?.invoke(error)
        }
    }

    // ---- battery to Home Assistant ----

    private fun reportBattery(value: ByteArray) {
        if (!settings.haBattery) return
        val b = Protocol.parseBattery(value) ?: return
        val now = android.os.SystemClock.elapsedRealtime()
        b.pct?.let { reportValue(socReport, settings.haSocEntity, it, now) }
        // the helper rejects values outside 0–60 V
        b.packV?.takeIf { it <= 60.0 }?.let { reportValue(voltageReport, settings.haVoltageEntity, it, now) }
    }

    /** Fire-and-forget; a failure only logs (once) and lets the next value retry. */
    private fun reportValue(throttle: HomeAssistant.Throttle, entity: String, value: Number, now: Long) {
        val (req, _) = HomeAssistant.setValue(settings.haUrl, settings.haToken, entity, value)
        if (req == null || !throttle.offer(value.toDouble(), now)) return // not set up, or not due
        batteryHttp.execute {
            val error = when (val r = HomeAssistant.send(req)) {
                HomeAssistant.Result.Ok -> null
                is HomeAssistant.Result.Failed -> r.reason
            }
            if (error != null) throttle.failed()
            if (error != batteryError) {
                Bus.log("battery", if (error == null) "Battery to HA works again" else "Battery to HA: $error", error == null)
                batteryError = error
            }
        }
    }

    // ---- time sync ----

    private val timeSync = Runnable { syncTime() }

    /** Send the time now and again in [TIME_SYNC_MS], while the link is up. */
    private fun syncTime() {
        handler.removeCallbacks(timeSync)
        val g = gatt
        if (!linkUp || g == null) return
        try {
            val (lat, lon) = Place.current(this, settings)
            writeControl(g, Protocol.timeSync(System.currentTimeMillis(), java.util.TimeZone.getDefault(), lat, lon))
        } catch (_: Exception) {
            // never let a failed sync take the link down; try again next time
        }
        handler.postDelayed(timeSync, TIME_SYNC_MS)
    }

    private fun linkDown() {
        linkUp = false
        handler.removeCallbacks(timeSync)
    }

    /** One write to the control characteristic, with response. */
    private fun writeControl(g: BluetoothGatt, value: ByteArray): Boolean {
        val c = g.getService(Protocol.SERVICE)?.getCharacteristic(Protocol.CONTROL) ?: return false
        return if (Build.VERSION.SDK_INT >= 33) {
            g.writeCharacteristic(c, value, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) ==
                BluetoothGatt.GATT_SUCCESS
        } else {
            c.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            @Suppress("DEPRECATION")
            c.value = value
            @Suppress("DEPRECATION")
            g.writeCharacteristic(c)
        }
    }

    // ---- notification ----

    private fun setState(state: String, text: String) {
        Bus.state(state)
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(text))
    }

    private fun createChannel() {
        val channel = NotificationChannel(CHANNEL, "Display link", NotificationManager.IMPORTANCE_LOW)
        channel.setShowBadge(false)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun notification(text: String): Notification {
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
        }
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentTitle("swet102")
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(open)
            .build()
    }
}
