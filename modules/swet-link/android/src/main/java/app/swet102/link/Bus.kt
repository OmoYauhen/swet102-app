package app.swet102.link

import android.content.Context
import android.content.SharedPreferences

/**
 * Hand-off between the service (which outlives the UI) and the Expo module
 * (which exists only while the JS app runs). The service publishes here; the
 * module forwards to JS when it's listening. The latest telemetry and trips are
 * kept, and saved, so a freshly opened UI shows the last known values at once,
 * even after a disconnect or a restart of the app.
 */
object Bus {
    interface Listener {
        fun onEvent(name: String, body: Map<String, Any?>)
    }

    @Volatile var listener: Listener? = null

    @Volatile var state: String = "off"
        private set
    @Volatile var telemetry: String? = null
        private set
    /** ms since epoch of [telemetry], 0 if none. */
    @Volatile var telemetryAt: Long = 0
        private set
    private val trips = arrayOfNulls<String>(4)
    private val log = ArrayDeque<Map<String, Any?>>()
    private var prefs: SharedPreferences? = null

    /** Loads the values saved by an earlier run. Safe to call more than once. */
    fun restore(context: Context) = synchronized(this) {
        if (prefs != null) return@synchronized
        val p = context.applicationContext.getSharedPreferences("swet102-last", Context.MODE_PRIVATE)
        prefs = p
        if (telemetry == null) {
            telemetry = p.getString("telemetry", null)
            telemetryAt = p.getLong("telemetryAt", 0)
        }
        for (i in trips.indices) if (trips[i] == null) trips[i] = p.getString("trip$i", null)
    }

    fun snapshot(): Map<String, Any?> = synchronized(this) {
        mapOf(
            "state" to state,
            "telemetry" to telemetry,
            "telemetryAt" to telemetryAt.toDouble(),
            "trips" to trips.filterNotNull(),
            "log" to log.toList(),
        )
    }

    fun state(s: String) {
        state = s
        listener?.onEvent("onState", mapOf("state" to s))
    }

    /** Raw characteristic values travel as hex; TypeScript decodes them. */
    fun telemetry(hex: String) {
        val at = System.currentTimeMillis()
        synchronized(this) {
            telemetry = hex
            telemetryAt = at
            prefs?.edit()?.putString("telemetry", hex)?.putLong("telemetryAt", at)?.apply()
        }
        listener?.onEvent("onTelemetry", mapOf("hex" to hex, "at" to at.toDouble()))
    }

    fun trip(id: Int, hex: String) {
        synchronized(this) {
            if (id in trips.indices) {
                trips[id] = hex
                prefs?.edit()?.putString("trip$id", hex)?.apply()
            }
        }
        listener?.onEvent("onTrip", mapOf("hex" to hex))
    }

    /** Commands and gate results, newest last, for the UI's activity list. */
    fun log(kind: String, text: String, ok: Boolean) {
        val entry = mapOf("at" to System.currentTimeMillis().toDouble(), "kind" to kind, "text" to text, "ok" to ok)
        synchronized(this) {
            log.addLast(entry)
            while (log.size > 30) log.removeFirst()
        }
        listener?.onEvent("onLog", entry)
    }
}

fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
