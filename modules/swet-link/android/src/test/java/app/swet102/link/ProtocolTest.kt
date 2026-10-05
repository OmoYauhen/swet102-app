package app.swet102.link

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
}
