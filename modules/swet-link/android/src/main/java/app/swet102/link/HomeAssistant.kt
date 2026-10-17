package app.swet102.link

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Calls Home Assistant services over its REST API:
 * `POST <base>/api/services/<domain>/<service>` with `{"entity_id": …}` and a
 * long-lived access token.
 *
 * - Gates: any service works, `button.press`, `switch.turn_on`,
 *   `cover.open_cover`, `script.turn_on`, …
 * - Battery: `input_number.set_value` on the e-bike helpers, throttled by
 *   [Throttle] (HA derives the sensors and the charging state from them).
 */
object HomeAssistant {
    data class Gate(
        /** "domain.service", e.g. "button.press". */
        val service: String,
        val entityId: String,
    )

    data class Request(val url: String, val token: String, val body: String)

    sealed class Result {
        object Ok : Result()
        data class Failed(val reason: String) : Result()
    }

    /** Builds the request, or explains what's missing from the settings. */
    fun request(baseUrl: String, token: String, gate: Gate): Pair<Request?, String?> {
        val (base, problem) = base(baseUrl, token)
        if (base == null) return null to problem
        val parts = gate.service.trim().split('.')
        if (parts.size != 2 || parts.any { it.isEmpty() }) {
            return null to "service must look like domain.service"
        }
        if (gate.entityId.isBlank()) return null to "no entity"
        val body = JSONObject().put("entity_id", gate.entityId.trim()).toString()
        return Request("$base/api/services/${parts[0]}/${parts[1]}", token.trim(), body) to null
    }

    /** `input_number.set_value` of [value] on [entityId]. */
    fun setValue(baseUrl: String, token: String, entityId: String, value: Number): Pair<Request?, String?> {
        val (base, problem) = base(baseUrl, token)
        if (base == null) return null to problem
        if (entityId.isBlank()) return null to "no entity"
        val body = JSONObject().put("entity_id", entityId.trim()).put("value", value).toString()
        return Request("$base/api/services/input_number/set_value", token.trim(), body) to null
    }

    /** The base URL without a trailing slash, or why the settings won't do. */
    private fun base(baseUrl: String, token: String): Pair<String?, String?> {
        val base = baseUrl.trim().trimEnd('/')
        if (base.isEmpty()) return null to "no Home Assistant URL"
        if (!base.startsWith("http://") && !base.startsWith("https://")) {
            return null to "URL must start with http:// or https://"
        }
        if (token.isBlank()) return null to "no access token"
        return base to null
    }

    /**
     * When to send a value that arrives every second: the first one after
     * [reset] (a new connection), then only when it moved by [minDelta] or more
     * and [minIntervalMs] have passed since the last send. After a [failed] send
     * the next due value goes out even if it didn't change.
     */
    class Throttle(private val minIntervalMs: Long, private val minDelta: Double) {
        private var last: Double? = null
        private var at = 0L
        private var fresh = true

        @Synchronized fun reset() {
            fresh = true
        }

        /** True if [value] should be sent now; it then counts as sent. */
        @Synchronized fun offer(value: Double, nowMs: Long): Boolean {
            val l = last
            val due = fresh ||
                (nowMs - at >= minIntervalMs && (l == null || Math.abs(value - l) >= minDelta - 1e-9))
            if (!due) return false
            fresh = false
            last = value
            at = nowMs
            return true
        }

        @Synchronized fun failed() {
            last = null
        }
    }

    /** Blocking: call from a worker thread. */
    fun send(req: Request, timeoutMs: Int = 8000): Result {
        return try {
            val conn = URL(req.url).openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.connectTimeout = timeoutMs
                conn.readTimeout = timeoutMs
                conn.doOutput = true
                conn.setRequestProperty("Authorization", "Bearer ${req.token}")
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(req.body.toByteArray()) }
                val code = conn.responseCode
                if (code in 200..299) Result.Ok else Result.Failed("HTTP $code")
            } finally {
                conn.disconnect()
            }
        } catch (e: Exception) {
            Result.Failed(e.javaClass.simpleName + (e.message?.let { ": $it" } ?: ""))
        }
    }
}
