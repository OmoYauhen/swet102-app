package app.swet102.link

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager

/**
 * Roughly where the phone is, for sunrise and sunset: the newest last known
 * location from any provider (no fresh fix, no Play Services), cached in
 * [Settings] so it still works when Android has none to give, and Warsaw if
 * we've never known.
 */
object Place {
    /** Refresh the cache if Android has a location for us, then return the best we have. */
    @SuppressLint("MissingPermission") // checked below
    fun current(context: Context, settings: Settings): Pair<Double, Double> {
        val granted = listOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)
            .any { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
        if (granted) {
            try {
                val lm = context.getSystemService(LocationManager::class.java)
                lm?.getProviders(true)
                    ?.mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
                    ?.maxByOrNull { it.time }
                    ?.let { settings.location = it.latitude to it.longitude }
            } catch (_: Exception) {
                // no location this time; the cache will do
            }
        }
        return settings.location ?: (Sun.WARSAW_LAT to Sun.WARSAW_LON)
    }
}
