package app.swet102.link

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Opens a gate by calling a Home Assistant service over its REST API:
 * `POST <base>/api/services/<domain>/<service>` with `{"entity_id": …}` and a
 * long-lived access token. Any service works: `button.press`, `switch.turn_on`,
 * `cover.open_cover`, `script.turn_on`, …
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
        val base = baseUrl.trim().trimEnd('/')
        if (base.isEmpty()) return null to "no Home Assistant URL"
        if (!base.startsWith("http://") && !base.startsWith("https://")) {
            return null to "URL must start with http:// or https://"
        }
        if (token.isBlank()) return null to "no access token"
        val parts = gate.service.trim().split('.')
        if (parts.size != 2 || parts.any { it.isEmpty() }) {
            return null to "service must look like domain.service"
        }
        if (gate.entityId.isBlank()) return null to "no entity"
        val body = JSONObject().put("entity_id", gate.entityId.trim()).toString()
        return Request("$base/api/services/${parts[0]}/${parts[1]}", token.trim(), body) to null
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
