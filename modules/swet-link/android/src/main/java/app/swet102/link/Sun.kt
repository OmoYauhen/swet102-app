package app.swet102.link

import java.util.Calendar
import java.util.TimeZone
import kotlin.math.acos
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.tan

/**
 * Sunrise and sunset, offline: the NOAA sunrise equation (the one behind the
 * NOAA solar calculator), zenith 90.833° (refraction + the sun's radius).
 * Good to about a minute at mid latitudes, which is plenty for bike lights.
 *
 * java.util time on purpose: minSdk 24 has no java.time without desugaring.
 */
object Sun {
    /** Local wall-clock minutes since local midnight (0..1439). */
    data class Times(val sunriseMin: Int, val sunsetMin: Int)

    /** Where we are when nothing better is known. */
    const val WARSAW_LAT = 52.23
    const val WARSAW_LON = 21.01

    private const val ZENITH = 90.833
    private const val DAY_MS = 86_400_000L

    /**
     * Today's sunrise and sunset at [lat]/[lon] (degrees, east positive), for
     * the local date of [nowMs] in [zone], in that zone's wall-clock time
     * (so DST is whatever the zone says on that date).
     */
    fun today(nowMs: Long, zone: TimeZone, lat: Double, lon: Double): Times {
        val local = Calendar.getInstance(zone).apply { timeInMillis = nowMs }
        val utc = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
            clear()
            set(local.get(Calendar.YEAR), local.get(Calendar.MONTH), local.get(Calendar.DAY_OF_MONTH))
        }
        val midnightUtcMs = utc.timeInMillis
        fun wallClock(utcMin: Double): Int {
            val at = midnightUtcMs + (utcMin * 60_000).roundToLong()
            val localMin = Math.floorDiv(at + zone.getOffset(at), 60_000L)
            return Math.floorMod(localMin, 1440L).toInt()
        }
        return Times(
            sunriseMin = wallClock(eventUtcMin(midnightUtcMs, lat, lon, rising = true)),
            sunsetMin = wallClock(eventUtcMin(midnightUtcMs, lat, lon, rising = false)),
        )
    }

    /** Minutes after 00:00 UTC of that date; refined once at the event time. */
    private fun eventUtcMin(midnightUtcMs: Long, lat: Double, lon: Double, rising: Boolean): Double {
        val jd0 = midnightUtcMs / DAY_MS.toDouble() + 2440587.5
        var min = 720.0
        repeat(2) {
            val t = (jd0 + min / 1440 - 2451545.0) / 36525
            val (eqTime, decl) = solar(t)
            val ha = hourAngle(lat, decl)
            min = 720 - 4 * (lon + if (rising) ha else -ha) - eqTime
        }
        return min
    }

    /** Equation of time (minutes) and declination (degrees) at Julian century [t]. */
    private fun solar(t: Double): Pair<Double, Double> {
        val l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)).mod(360.0)
        val m = 357.52911 + t * (35999.05029 - 0.0001537 * t)
        val e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
        val c = sinD(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
            sinD(2 * m) * (0.019993 - 0.000101 * t) + sinD(3 * m) * 0.000289
        val omega = 125.04 - 1934.136 * t
        val lambda = l0 + c - 0.00569 - 0.00478 * sinD(omega)
        val e0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
        val eps = e0 + 0.00256 * cosD(omega)
        val decl = deg(asin(sinD(eps) * sinD(lambda)))
        val y = tan(rad(eps / 2)).let { it * it }
        val eqTime = 4 * deg(
            y * sinD(2 * l0) - 2 * e * sinD(m) + 4 * e * y * sinD(m) * cosD(2 * l0) -
                0.5 * y * y * sinD(4 * l0) - 1.25 * e * e * sinD(2 * m),
        )
        return eqTime to decl
    }

    /**
     * Degrees from solar noon to the event. Clamped where the sun never sets
     * (180°: both events at midnight) or never rises (0°: both at noon).
     */
    private fun hourAngle(lat: Double, decl: Double): Double {
        val x = cosD(ZENITH) / (cosD(lat) * cosD(decl)) - tanD(lat) * tanD(decl)
        return deg(acos(x.coerceIn(-1.0, 1.0)))
    }

    private fun rad(d: Double) = Math.toRadians(d)
    private fun deg(r: Double) = Math.toDegrees(r)
    private fun sinD(d: Double) = sin(rad(d))
    private fun cosD(d: Double) = cos(rad(d))
    private fun tanD(d: Double) = tan(rad(d))
}
