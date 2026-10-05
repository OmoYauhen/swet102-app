package app.swet102.link

/**
 * Hand-off between the service (which outlives the UI) and the Expo module
 * (which exists only while the JS app runs). The service publishes here; the
 * module forwards to JS when it's listening. The latest values are kept so a
 * freshly opened UI shows something at once.
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
    private val trips = arrayOfNulls<String>(4)
    private val log = ArrayDeque<Map<String, Any?>>()

    fun snapshot(): Map<String, Any?> = synchronized(this) {
        mapOf(
            "state" to state,
            "telemetry" to telemetry,
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
        telemetry = hex
        listener?.onEvent("onTelemetry", mapOf("hex" to hex))
    }

    fun trip(id: Int, hex: String) {
        synchronized(this) { if (id in trips.indices) trips[id] = hex }
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
