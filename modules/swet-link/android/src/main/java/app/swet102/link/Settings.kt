package app.swet102.link

import android.content.Context

/**
 * Everything the service needs to run without the UI: the display's address,
 * whether the link is on, and the Home Assistant gate setup. Private app
 * storage; the token never leaves the phone except in the HA request.
 */
class Settings(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("swet102", Context.MODE_PRIVATE)

    var address: String?
        get() = prefs.getString("address", null)
        set(v) = prefs.edit().putString("address", v).apply()

    /** The user wants the link running; the service restarts at boot. */
    var enabled: Boolean
        get() = prefs.getBoolean("enabled", false)
        set(v) = prefs.edit().putBoolean("enabled", v).apply()

    var haUrl: String
        get() = prefs.getString("haUrl", "") ?: ""
        set(v) = prefs.edit().putString("haUrl", v).apply()

    var haToken: String
        get() = prefs.getString("haToken", "") ?: ""
        set(v) = prefs.edit().putString("haToken", v).apply()

    fun gate(which: Char): HomeAssistant.Gate = HomeAssistant.Gate(
        service = prefs.getString("gate${which}Service", "button.press") ?: "",
        entityId = prefs.getString("gate${which}Entity", "") ?: "",
    )

    fun setGate(which: Char, gate: HomeAssistant.Gate) {
        prefs.edit()
            .putString("gate${which}Service", gate.service)
            .putString("gate${which}Entity", gate.entityId)
            .apply()
    }
}
