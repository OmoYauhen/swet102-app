package app.swet102.link

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.zip.ZipInputStream
import org.json.JSONObject

/**
 * Reads an nrfutil DFU package (`make release` in swet102) before it goes to
 * the display's Secure DFU bootloader (nRF5 SDK 12): manifest.json, the .dat
 * init packet and the .bin. Pure JVM, so the JVM unit tests cover it.
 *
 * The init packet is protobuf (SDK 12 `dfu-cc.proto`):
 * ```
 * Packet        { Command command = 1; SignedCommand signed_command = 2; }
 * SignedCommand { Command command = 1; SignatureType signature_type = 2; bytes signature = 3; }
 * Command       { OpCode op_code = 1; InitCommand init = 2; }      // op_code INIT = 1
 * InitCommand   { uint32 fw_version = 1; uint32 hw_version = 2; repeated uint32 sd_req = 3 [packed];
 *                 FwType type = 4; uint32 sd_size = 5; uint32 bl_size = 6; uint32 app_size = 7;
 *                 Hash hash = 8; bool is_debug = 9; }               // FwType APPLICATION = 0
 * Hash          { HashType hash_type = 1; bytes hash = 2; }        // SHA256 = 3, stored reversed
 * ```
 * Unknown fields are skipped, so newer nrfutil additions don't break it.
 */
object Firmware {
    class Invalid(message: String) : Exception(message)

    const val TYPE_APPLICATION = 0
    private const val OP_INIT = 1
    private const val HASH_SHA256 = 3
    /** Far above the 115 KB app region; anything bigger isn't for this display. */
    private const val MAX_ENTRY = 512 * 1024

    data class InitPacket(
        val fwVersion: Long,
        val hwVersion: Long,
        val sdReq: List<Long>,
        val type: Int,
        val appSize: Long,
        val hashType: Int?,
        val hash: ByteArray?,
        val isDebug: Boolean,
        val signed: Boolean,
    )

    data class Info(
        val init: InitPacket,
        /** Bytes of the .bin, as checked against the init packet. */
        val binSize: Int,
        val binFile: String,
        val datFile: String,
    )

    // ---- zip ----

    /** Validates a whole package; throws [Invalid] with a reason a person can act on. */
    fun inspectZip(input: InputStream): Info {
        val entries = readZip(input)
        val manifestBytes = entries["manifest.json"] ?: throw Invalid("Not a DFU package: no manifest.json in the zip")
        val manifest = try {
            JSONObject(String(manifestBytes, Charsets.UTF_8)).getJSONObject("manifest")
        } catch (e: Exception) {
            throw Invalid("Not a DFU package: manifest.json can't be read")
        }
        val kinds = manifest.keys().asSequence().toList()
        if (kinds != listOf("application")) {
            throw Invalid("Only application updates are supported; this package has: ${kinds.joinToString()}")
        }
        val app = manifest.getJSONObject("application")
        val datFile = app.optString("dat_file", "")
        val binFile = app.optString("bin_file", "")
        val dat = entries[datFile] ?: throw Invalid("The package is missing its init packet ($datFile)")
        val bin = entries[binFile] ?: throw Invalid("The package is missing its firmware image ($binFile)")
        val init = parseInitPacket(dat)
        if (init.type != TYPE_APPLICATION) throw Invalid("The init packet is not for an application (type ${init.type})")
        if (init.appSize != bin.size.toLong()) {
            throw Invalid("The init packet says ${init.appSize} bytes but the image has ${bin.size}")
        }
        if (init.hashType == HASH_SHA256 && init.hash != null) {
            val sha = MessageDigest.getInstance("SHA-256").digest(bin)
            // nrfutil stores the digest little-endian; accept either order
            if (!sha.contentEquals(init.hash) && !sha.reversedArray().contentEquals(init.hash)) {
                throw Invalid("The firmware image doesn't match the init packet's hash (corrupt package?)")
            }
        }
        return Info(init, bin.size, binFile, datFile)
    }

    private fun readZip(input: InputStream): Map<String, ByteArray> {
        val out = HashMap<String, ByteArray>()
        try {
            ZipInputStream(input).use { zip ->
                val buf = ByteArray(8192)
                while (true) {
                    val e = zip.nextEntry ?: break
                    if (e.isDirectory) continue
                    val bytes = ByteArrayOutputStream()
                    while (true) {
                        val n = zip.read(buf)
                        if (n < 0) break
                        bytes.write(buf, 0, n)
                        if (bytes.size() > MAX_ENTRY) throw Invalid("${e.name} is too big for this display")
                    }
                    out[e.name] = bytes.toByteArray()
                    if (out.size > 16) throw Invalid("Not a DFU package: too many files")
                }
            }
        } catch (e: Invalid) {
            throw e
        } catch (e: Exception) {
            throw Invalid("Not a zip file (${e.message ?: e.javaClass.simpleName})")
        }
        if (out.isEmpty()) throw Invalid("Not a zip file, or an empty one")
        return out
    }

    // ---- init packet ----

    fun parseInitPacket(bytes: ByteArray): InitPacket = try {
        parsePacket(bytes)
    } catch (e: Invalid) {
        throw e
    } catch (e: Exception) {
        throw Invalid("The init packet is malformed")
    }

    private fun parsePacket(bytes: ByteArray): InitPacket {
        var command: ByteArray? = null
        var signed = false
        for (f in fields(bytes)) {
            when (f.number) {
                1 -> if (command == null) command = f.bytes()
                2 -> {
                    // SignedCommand: we don't check the signature; the bootloader does
                    for (sf in fields(f.bytes())) if (sf.number == 1) command = sf.bytes()
                    signed = true
                }
            }
        }
        val cmd = command ?: throw Invalid("The init packet has no command")
        var opCode = 0L
        var init: ByteArray? = null
        for (f in fields(cmd)) {
            when (f.number) {
                1 -> opCode = f.varint()
                2 -> init = f.bytes()
            }
        }
        if (opCode != OP_INIT.toLong() || init == null) throw Invalid("The init packet has no init command")

        var fw: Long? = null
        var hw = 0L
        val sdReq = ArrayList<Long>()
        var type = TYPE_APPLICATION
        var appSize = 0L
        var hashType: Int? = null
        var hash: ByteArray? = null
        var debug = false
        for (f in fields(init)) {
            when (f.number) {
                1 -> fw = f.varint()
                2 -> hw = f.varint()
                3 -> if (f.wireType == 2) {
                    val r = Reader(f.bytes())
                    while (!r.done) sdReq += r.varint()
                } else {
                    sdReq += f.varint()
                }
                4 -> type = f.varint().toInt()
                7 -> appSize = f.varint()
                8 -> for (hf in fields(f.bytes())) {
                    when (hf.number) {
                        1 -> hashType = hf.varint().toInt()
                        2 -> hash = hf.bytes()
                    }
                }
                9 -> debug = f.varint() != 0L
            }
        }
        return InitPacket(
            fwVersion = fw ?: throw Invalid("The init packet has no firmware version"),
            hwVersion = hw,
            sdReq = sdReq,
            type = type,
            appSize = appSize,
            hashType = hashType,
            hash = hash,
            isDebug = debug,
            signed = signed,
        )
    }

    // ---- minimal protobuf reader ----

    private class Field(val number: Int, val wireType: Int, private val value: Any) {
        fun varint(): Long = value as? Long ?: throw Invalid("The init packet is malformed (field $number)")
        fun bytes(): ByteArray = value as? ByteArray ?: throw Invalid("The init packet is malformed (field $number)")
    }

    private class Reader(val b: ByteArray) {
        var pos = 0
        val done get() = pos >= b.size

        fun varint(): Long {
            var result = 0L
            var shift = 0
            while (true) {
                if (pos >= b.size || shift > 63) throw Invalid("The init packet is truncated")
                val x = b[pos++].toInt() and 0xFF
                result = result or ((x and 0x7F).toLong() shl shift)
                if (x and 0x80 == 0) return result
                shift += 7
            }
        }

        fun take(n: Long): ByteArray {
            if (n < 0 || pos + n > b.size) throw Invalid("The init packet is truncated")
            val out = b.copyOfRange(pos, pos + n.toInt())
            pos += n.toInt()
            return out
        }
    }

    private fun fields(bytes: ByteArray): List<Field> {
        val r = Reader(bytes)
        val out = ArrayList<Field>()
        while (!r.done) {
            val key = r.varint()
            val number = (key ushr 3).toInt()
            val wire = (key and 7).toInt()
            if (number == 0) throw Invalid("The init packet is malformed")
            val value: Any = when (wire) {
                0 -> r.varint()
                1 -> r.take(8)
                2 -> r.take(r.varint())
                5 -> r.take(4)
                else -> throw Invalid("The init packet is malformed (wire type $wire)")
            }
            out += Field(number, wire, value)
        }
        return out
    }
}
