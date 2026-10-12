package app.swet102.link

import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Reference times: timeanddate.com for the solstices, and the `astral` Python
 * library (also NOAA) for the rest, rounded to the minute.
 */
class SunTest {
    private val warsaw = ZoneId.of("Europe/Warsaw")

    private fun ms(iso: String): Long = ZonedDateTime.parse(iso).toInstant().toEpochMilli()

    private fun warsawSun(iso: String) =
        Sun.today(ms(iso), TimeZone.getTimeZone(warsaw), Sun.WARSAW_LAT, Sun.WARSAW_LON)

    private fun assertNear(expectedHhMm: String, actualMin: Int, toleranceMin: Int = 2) {
        val (h, m) = expectedHhMm.split(":").map { it.toInt() }
        val expected = h * 60 + m
        assertTrue(
            "expected ~$expectedHhMm, got %02d:%02d".format(actualMin / 60, actualMin % 60),
            kotlin.math.abs(actualMin - expected) <= toleranceMin,
        )
    }

    @Test
    fun warsawMidsummer() {
        val sun = warsawSun("2026-06-21T12:00:00+02:00[Europe/Warsaw]")
        assertNear("04:14", sun.sunriseMin) // CEST
        assertNear("21:01", sun.sunsetMin)
    }

    @Test
    fun warsawMidwinter() {
        val sun = warsawSun("2026-12-21T12:00:00+01:00[Europe/Warsaw]")
        assertNear("07:43", sun.sunriseMin) // CET
        assertNear("15:25", sun.sunsetMin)
    }

    @Test
    fun warsawEquinoxes() {
        warsawSun("2026-03-20T12:00:00+01:00[Europe/Warsaw]").let {
            assertNear("05:39", it.sunriseMin)
            assertNear("17:49", it.sunsetMin)
        }
        warsawSun("2026-09-23T12:00:00+02:00[Europe/Warsaw]").let {
            assertNear("06:24", it.sunriseMin)
            assertNear("18:32", it.sunsetMin)
        }
    }

    @Test
    fun usesTheLocalDateNotTheUtcDate() {
        // 00:30 CEST on 21 June is still 20 June in UTC
        val early = warsawSun("2026-06-21T00:30:00+02:00[Europe/Warsaw]")
        val late = warsawSun("2026-06-21T23:30:00+02:00[Europe/Warsaw]")
        assertEquals(early, late)
    }

    @Test
    fun dstStartMovesTheSunTimesAnHourLater() {
        // EU summer time starts 2026-03-29 at 02:00 CET
        val before = warsawSun("2026-03-28T12:00:00+01:00[Europe/Warsaw]")
        val after = warsawSun("2026-03-29T12:00:00+02:00[Europe/Warsaw]")
        assertNear("18:03", before.sunsetMin)
        assertNear("19:04", after.sunsetMin)
        // the sun itself moves ~2-3 min a day; the rest is the clock change
        assertTrue(after.sunsetMin - before.sunsetMin in 61..63)
        assertTrue(after.sunriseMin - before.sunriseMin in 57..59)
        // sunrise that day is after the jump, so it is already in CEST
        assertNear("06:18", after.sunriseMin)
    }

    @Test
    fun dstEndMovesTheSunTimesAnHourEarlier() {
        // EU summer time ends 2026-10-25 at 03:00 CEST
        val before = warsawSun("2026-10-24T12:00:00+02:00[Europe/Warsaw]")
        val after = warsawSun("2026-10-25T12:00:00+01:00[Europe/Warsaw]")
        assertTrue(before.sunsetMin - after.sunsetMin in 61..63)
        assertTrue(before.sunriseMin - after.sunriseMin in 57..59)
    }

    @Test
    fun otherPlaceAndZone() {
        // Lisbon, 2026-06-21 (WEST, UTC+1): ~06:12 / ~21:05
        val sun = Sun.today(
            ms("2026-06-21T12:00:00+01:00[Europe/Lisbon]"),
            TimeZone.getTimeZone("Europe/Lisbon"),
            38.72,
            -9.14,
        )
        assertNear("06:12", sun.sunriseMin)
        assertNear("21:05", sun.sunsetMin)
    }
}
