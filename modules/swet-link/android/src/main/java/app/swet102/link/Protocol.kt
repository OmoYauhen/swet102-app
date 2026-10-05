package app.swet102.link

import java.util.UUID

/**
 * The Swet102 display's GATT protocol (swet102 docs/TECH_DESIGN.md §9.4).
 *
 * Telemetry and trips are decoded in TypeScript (src/protocol); the service only
 * needs to understand commands, because it acts on them with the screen off.
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

    /** Characteristics we subscribe to, in the order the CCCDs are written. */
    val NOTIFY = listOf(COMMAND, TELEMETRY, TRIPS)

    /** Written to the control characteristic: the display reboots into DFU. */
    val CONTROL_DFU = "DFU!".toByteArray(Charsets.US_ASCII)

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
