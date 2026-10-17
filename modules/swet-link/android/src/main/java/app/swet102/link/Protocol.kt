package app.swet102.link

import java.util.Calendar
import java.util.TimeZone
import java.util.UUID

/**
 * The Swet102 display's GATT protocol (swet102 docs/TECH_DESIGN.md §9.4).
 *
 * Telemetry and trips are decoded in TypeScript (src/protocol); the service only
 * needs to understand commands and the battery fields of telemetry, because it
 * acts on them with the screen off.
 */
object Protocol {
    const val DEVICE_NAME = "swet102"

    private fun uuid(short: Int): UUID =
        UUID.fromString(String.format("8f03%04x-da4c-453d-a163-41a592a0e9fd", short))

    val SERVICE: UUID = uuid(0x0001)
    val TELEMETRY: UUID = uuid(0x0002)
    val COMMAND: UUID = uuid(0x0003)
    val CONTROL: UUID = uuid(0x0004)
    val TRIPS: UUID = uuid(0x0005)
    val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    private fun sig(short: Int): UUID =
        UUID.fromString(String.format("0000%04x-0000-1000-8000-00805f9b34fb", short))

    /** Device Information service. */
    val DIS: UUID = sig(0x180A)
    /** Firmware Revision String: the semver, e.g. "0.1.0". */
    val DIS_FIRMWARE_REV: UUID = sig(0x2A26)
    /**
     * Software Revision String: the build, VERSION_NUM (YYMMDDHH, UTC) as text,
     * e.g. "26101610", or "-" for a build not made by `make`. Firmware before
     * the OTA tab has no such characteristic.
     */
    val DIS_SOFTWARE_REV: UUID = sig(0x2A28)
    /** Nordic Secure DFU service: what the display's bootloader (SW102_DFU) offers. */
    val SECURE_DFU: UUID = sig(0xFE59)

    /** The bootloader's advertised name while it waits for an update. */
    const val DFU_NAME = "SW102_DFU"

    /** Characteristics we subscribe to, in the order the CCCDs are written. */
    val NOTIFY = listOf(COMMAND, TELEMETRY, TRIPS)

    /** Tag of the time-sync write to the control characteristic ('T'). */
    const val CONTROL_TIME: Byte = 0x54

    /**
     * Time sync for the display's Lights AUTO mode (it has no clock), 9 bytes,
     * little-endian: `'T'`, u32 seconds since local midnight, u16 today's
     * sunset and u16 today's sunrise in minutes since local midnight.
     */
    fun timeSync(secsOfDay: Int, sunsetMin: Int, sunriseMin: Int): ByteArray {
        val b = ByteArray(9)
        b[0] = CONTROL_TIME
        for (i in 0 until 4) b[1 + i] = (secsOfDay ushr (8 * i)).toByte()
        for (i in 0 until 2) b[5 + i] = (sunsetMin ushr (8 * i)).toByte()
        for (i in 0 until 2) b[7 + i] = (sunriseMin ushr (8 * i)).toByte()
        return b
    }

    /**
     * The time sync for [nowMs]: wall-clock time in [zone] (DST included) and
     * today's sun times at [lat]/[lon].
     */
    fun timeSync(nowMs: Long, zone: TimeZone, lat: Double, lon: Double): ByteArray {
        val c = Calendar.getInstance(zone).apply { timeInMillis = nowMs }
        val secs = c.get(Calendar.HOUR_OF_DAY) * 3600 + c.get(Calendar.MINUTE) * 60 + c.get(Calendar.SECOND)
        val sun = Sun.today(nowMs, zone, lat, lon)
        return timeSync(secs, sun.sunsetMin, sun.sunriseMin)
    }

    /** Telemetry length in bytes per version: v3 adds the pack voltage. */
    private val TELEMETRY_LEN = mapOf(2 to 14, 3 to 16)

    /** State of charge in % and pack voltage rounded to 0.1 V; null when unknown. */
    data class Battery(val pct: Int?, val packV: Double?)

    /**
     * The battery fields of a telemetry value (soc at byte 5, 0xff = no reading
     * yet; v3 pack voltage at 14, u16 in 10 mV, 0 = not measured). Null if
     * it isn't telemetry this app knows.
     */
    fun parseBattery(value: ByteArray): Battery? {
        val version = value.firstOrNull()?.toInt() ?: return null
        if (value.size != TELEMETRY_LEN[version]) return null
        val soc = value[5].toInt() and 0xFF
        val cv = if (version >= 3) (value[14].toInt() and 0xFF) or ((value[15].toInt() and 0xFF) shl 8) else 0
        return Battery(
            pct = soc.takeIf { it <= 100 },
            packV = if (cv == 0) null else Math.round(cv / 10.0) / 10.0,
        )
    }

    enum class Command(val code: Int) {
        VOLUME_UP(0x01),
        VOLUME_DOWN(0x02),
        NEXT_TRACK(0x03),
        PREV_TRACK(0x04),
        PLAY_PAUSE(0x05),
        GATE_A(0x10),
        GATE_B(0x11);

        companion object {
            fun of(code: Int): Command? = entries.firstOrNull { it.code == code }
        }
    }

    /** A command notification: `[seq, code]`. */
    data class CommandPacket(val seq: Int, val command: Command)

    fun parseCommand(value: ByteArray): CommandPacket? {
        if (value.size != 2) return null
        val command = Command.of(value[1].toInt() and 0xFF) ?: return null
        return CommandPacket(value[0].toInt() and 0xFF, command)
    }

    /**
     * Drops repeated notifications. `seq` counts per press on the display and
     * starts again at 1 after it reboots, so call [reset] on every new connection.
     */
    class Dedup {
        private var last: Int? = null

        fun reset() {
            last = null
        }

        /** True if this packet is new. */
        fun accept(p: CommandPacket): Boolean {
            if (p.seq == last) return false
            last = p.seq
            return true
        }
    }
}
