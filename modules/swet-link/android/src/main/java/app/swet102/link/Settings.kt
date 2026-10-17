package app.swet102.link

import android.content.Context

/**
 * Everything the service needs to run without the UI: the display's address,
 * whether the link is on, and the Home Assistant gate and battery setup. Private app
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

    /** Push the battery to Home Assistant (needs [haUrl] and [haToken] too). */
    var haBattery: Boolean
        get() = prefs.getBoolean("haBattery", true)
        set(v) = prefs.edit().putBoolean("haBattery", v).apply()

    /** input_number helper for the state of charge, 0–100 %. */
    var haSocEntity: String
        get() = prefs.getString("haSocEntity", null) ?: "input_number.e_bike_battery_soc_raw"
        set(v) = prefs.edit().putString("haSocEntity", v).apply()

    /** input_number helper for the pack voltage, 0–60 V. */
    var haVoltageEntity: String
        get() = prefs.getString("haVoltageEntity", null) ?: "input_number.e_bike_battery_voltage_raw"
        set(v) = prefs.edit().putString("haVoltageEntity", v).apply()

    /**
     * The display's build (DIS Software Revision, YYMMDDHH) as read on the last
     * connect; null if its firmware doesn't publish one. Kept so the OTA tab
     * knows it while the display sits in its bootloader.
     */
    var displayBuild: String?
        get() = prefs.getString("displayBuild", null)
        set(v) = prefs.edit().putString("displayBuild", v).apply()

    /** The display's firmware version (DIS Firmware Revision, semver), as last read. */
    var displayVersion: String?
        get() = prefs.getString("displayVersion", null)
        set(v) = prefs.edit().putString("displayVersion", v).apply()

    /** Last known phone location (lat, lon), for sunrise/sunset; null if never known. */
    var location: Pair<Double, Double>?
        get() = if (prefs.contains("lat") && prefs.contains("lon")) {
            prefs.getFloat("lat", 0f).toDouble() to prefs.getFloat("lon", 0f).toDouble()
        } else {
            null
        }
        set(v) {
            val e = prefs.edit()
            if (v == null) e.remove("lat").remove("lon") else e.putFloat("lat", v.first.toFloat()).putFloat("lon", v.second.toFloat())
            e.apply()
        }

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
