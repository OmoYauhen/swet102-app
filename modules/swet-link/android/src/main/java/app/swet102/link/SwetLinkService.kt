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
 * - On every connect, subscribe to command, telemetry and trips again (no
 *   bonding, so the display keeps no subscriptions).
 * - Commands: volume and media keys locally, gates through Home Assistant.
 *
 * All GATT work runs on one handler thread; Android allows one GATT operation
 * at a time, so CCCD writes are chained through their callbacks.
 */
@SuppressLint("MissingPermission") // the UI starts us only once BLUETOOTH_CONNECT is granted
class SwetLinkService : Service() {
    companion object {
        private const val CHANNEL = "link"
        private const val NOTIFICATION_ID = 1
        private const val RECONNECT_DELAY_MS = 1000L

        @Volatile var instance: SwetLinkService? = null
            private set

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

    private var gatt: BluetoothGatt? = null
    private var pendingCccds = ArrayDeque<BluetoothGattDescriptor>()
    private var stopping = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
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
            gatt?.disconnect()
            gatt?.close()
            gatt = null
            thread.quitSafely()
        }
        http.shutdown()
        instance = null
        Bus.state("off")
        super.onDestroy()
    }

    // ---- connection ----

    private fun adapter(): BluetoothAdapter? =
        (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter

    private fun connect() {
        if (stopping || gatt != null) return
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
        gatt?.close()
        gatt = null
        if (!stopping) handler.postDelayed({ connect() }, RECONNECT_DELAY_MS)
    }

    private val adapterState = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1)) {
                BluetoothAdapter.STATE_ON -> handler.post { connect() }
                BluetoothAdapter.STATE_OFF -> handler.post {
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
                if (status != BluetoothGatt.GATT_SUCCESS || service == null) {
                    // Not a Swet102 display (or a stale cache): start over.
                    g.disconnect()
                    return@post
                }
                pendingCccds = ArrayDeque(
                    Protocol.NOTIFY.mapNotNull { uuid ->
                        service.getCharacteristic(uuid)?.let { c ->
                            g.setCharacteristicNotification(c, true)
                            c.getDescriptor(Protocol.CCCD)
                        }
                    },
                )
                writeNextCccd(g)
            }
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

    private fun writeNextCccd(g: BluetoothGatt) {
        val d = pendingCccds.removeFirstOrNull()
        if (d == null) {
            setState("connected", "Connected to the display")
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
            Protocol.TELEMETRY -> Bus.telemetry(value.toHex())
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

    /** Ask the display to reboot into its bootloader (it refuses while moving). */
    fun rebootToDfu(): Boolean {
        val g = gatt ?: return false
        val c = g.getService(Protocol.SERVICE)?.getCharacteristic(Protocol.CONTROL) ?: return false
        return if (Build.VERSION.SDK_INT >= 33) {
            g.writeCharacteristic(c, Protocol.CONTROL_DFU, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) ==
                BluetoothGatt.GATT_SUCCESS
        } else {
            @Suppress("DEPRECATION")
            c.value = Protocol.CONTROL_DFU
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
