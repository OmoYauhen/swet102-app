package app.swet102.link

import java.time.ZonedDateTime
import java.util.TimeZone
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {
    @Test
    fun uuidsFollowTheBase() {
        assertEquals("8f030003-da4c-453d-a163-41a592a0e9fd", Protocol.COMMAND.toString())
        assertEquals("8f030005-da4c-453d-a163-41a592a0e9fd", Protocol.TRIPS.toString())
    }

    @Test
    fun parsesCommands() {
        val p = Protocol.parseCommand(byteArrayOf(200.toByte(), 0x10))
        assertEquals(Protocol.CommandPacket(200, Protocol.Command.GATE_A), p)
        assertEquals(Protocol.Command.PLAY_PAUSE, Protocol.parseCommand(byteArrayOf(1, 5))?.command)
    }

    @Test
    fun rejectsUnknownOrMalformed() {
        assertNull(Protocol.parseCommand(byteArrayOf(1, 0x42)))
        assertNull(Protocol.parseCommand(byteArrayOf(1)))
        assertNull(Protocol.parseCommand(byteArrayOf(1, 1, 1)))
    }

    @Test
    fun dedupDropsRepeatsAndResetsPerConnection() {
        val d = Protocol.Dedup()
        val a = Protocol.CommandPacket(1, Protocol.Command.GATE_A)
        assertTrue(d.accept(a))
        assertFalse(d.accept(a))
        assertTrue(d.accept(Protocol.CommandPacket(2, Protocol.Command.GATE_A)))
        d.reset() // display rebooted: seq starts at 1 again
        assertTrue(d.accept(a))
    }

    private fun bytes(vararg b: Int) = ByteArray(b.size) { b[it].toByte() }

    private fun ms(iso: String): Long = ZonedDateTime.parse(iso).toInstant().toEpochMilli()

    private val warsaw = TimeZone.getTimeZone("Europe/Warsaw")

    @Test
    fun encodesTimeSyncLittleEndian() {
        // 23:59:59, sunset 21:01, sunrise 04:14
        assertArrayEquals(
            bytes(0x54, 0x7F, 0x51, 0x01, 0x00, 0xED, 0x04, 0xFE, 0x00),
            Protocol.timeSync(86_399, 1261, 254),
        )
        assertArrayEquals(
            bytes(0x54, 0, 0, 0, 0, 0, 0, 0, 0),
            Protocol.timeSync(0, 0, 0),
        )
    }

    @Test
    fun timeSyncUsesLocalWallClock() {
        val p = Protocol.timeSync(ms("2026-06-21T12:34:56+02:00[Europe/Warsaw]"), warsaw, 52.23, 21.01)
        assertEquals(9, p.size)
        assertEquals(0x54.toByte(), p[0])
        assertArrayEquals(u32(12 * 3600 + 34 * 60 + 56), p.copyOfRange(1, 5))
        assertEquals(Sun.today(ms("2026-06-21T12:00:00+02:00"), warsaw, 52.23, 21.01).sunsetMin, u16(p, 5))
        assertEquals(Sun.today(ms("2026-06-21T12:00:00+02:00"), warsaw, 52.23, 21.01).sunriseMin, u16(p, 7))
    }

    @Test
    fun timeSyncAcrossDst() {
        // 03:30 CEST just after the spring jump: wall clock, not elapsed time
        val spring = Protocol.timeSync(ms("2026-03-29T03:30:00+02:00[Europe/Warsaw]"), warsaw, 52.23, 21.01)
        assertArrayEquals(u32(3 * 3600 + 1800), spring.copyOfRange(1, 5))
        // 02:30 happens twice when summer time ends; both say 02:30
        val first = Protocol.timeSync(ms("2026-10-25T02:30:00+02:00"), warsaw, 52.23, 21.01)
        val second = Protocol.timeSync(ms("2026-10-25T02:30:00+01:00"), warsaw, 52.23, 21.01)
        assertArrayEquals(u32(2 * 3600 + 1800), first.copyOfRange(1, 5))
        assertArrayEquals(first, second)
        // the same instant in UTC is an hour or two earlier on the clock
        val utc = Protocol.timeSync(ms("2026-06-21T12:00:00Z"), TimeZone.getTimeZone("UTC"), 52.23, 21.01)
        val local = Protocol.timeSync(ms("2026-06-21T12:00:00Z"), warsaw, 52.23, 21.01)
        assertArrayEquals(u32(12 * 3600), utc.copyOfRange(1, 5))
        assertArrayEquals(u32(14 * 3600), local.copyOfRange(1, 5))
        assertEquals(u16(local, 5) - 120, u16(utc, 5))
    }

    private fun u32(v: Int) = bytes(v and 0xFF, (v shr 8) and 0xFF, (v shr 16) and 0xFF, (v shr 24) and 0xFF)

    private fun u16(b: ByteArray, at: Int) = (b[at].toInt() and 0xFF) or ((b[at + 1].toInt() and 0xFF) shl 8)

    private fun telemetry(version: Int, soc: Int, centivolts: Int = 0): ByteArray {
        val b = ByteArray(if (version >= 3) 16 else 14)
        b[0] = version.toByte()
        b[5] = soc.toByte()
        if (version >= 3) {
            b[14] = centivolts.toByte()
            b[15] = (centivolts shr 8).toByte()
        }
        return b
    }

    @Test
    fun parsesBatteryFromTelemetry() {
        assertEquals(Protocol.Battery(72, 52.3), Protocol.parseBattery(telemetry(3, 72, 5234)))
        assertEquals(Protocol.Battery(72, 52.4), Protocol.parseBattery(telemetry(3, 72, 5236)))
        // no reading yet / not measured / v2 without the voltage
        assertEquals(Protocol.Battery(null, null), Protocol.parseBattery(telemetry(3, 0xff, 0)))
        assertEquals(Protocol.Battery(40, null), Protocol.parseBattery(telemetry(2, 40)))
    }

    @Test
    fun rejectsUnknownTelemetry() {
        assertNull(Protocol.parseBattery(ByteArray(0)))
        assertNull(Protocol.parseBattery(telemetry(3, 50).copyOf(14)))
        assertNull(Protocol.parseBattery(telemetry(3, 50).also { it[0] = 4 }))
    }
}
