package app.swet102.link

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class FirmwareTest {
    private fun hex(s: String) = s.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    /** The init packet nRF Toolbox sent to the display's bootloader (swet102 dfu_log.txt). */
    private val logPacket = hex(
        "128C010A460801124208B085B90C10331A02870120002800300038F07B42240803122069B137FA67" +
            "258FC2E64FE5F1D079DB4FF38822AB446044734662383C6105F016480052040801120010001A4010" +
            "9C86DB8DA8633945031B44A42C31AD61B8BDD50274B2E9DE6E37846F1FDEE9E5712A9438705F4B25" +
            "A942A0BF38CCFA0A7D7677C83B3525E6F71A28E7563A9C",
    )

    @Test
    fun parsesTheInitPacketFromTheToolboxLog() {
        assertEquals(143, logPacket.size)
        val p = Firmware.parseInitPacket(logPacket)
        assertEquals(26100400L, p.fwVersion)
        assertEquals(51L, p.hwVersion)
        assertEquals(listOf(0x87L), p.sdReq)
        assertEquals(Firmware.TYPE_APPLICATION, p.type)
        assertEquals(15856L, p.appSize)
        assertEquals(3, p.hashType)
        assertEquals(32, p.hash!!.size)
        assertFalse(p.isDebug)
        assertTrue(p.signed)
    }

    @Test
    fun parsesTheDatOfARealRelease() {
        // swet102.dat from ~/git/swet102/build/swet102-26101610.zip
        val dat = javaClass.classLoader!!.getResourceAsStream("swet102-26101610.dat")!!.readBytes()
        val p = Firmware.parseInitPacket(dat)
        assertEquals(26101610L, p.fwVersion)
        assertEquals(51L, p.hwVersion)
        assertEquals(listOf(0x87L), p.sdReq)
        assertEquals(46564L, p.appSize)
        // SHA-256 of that zip's swet102.bin, stored reversed by nrfutil
        val sha = hex("217533bcd483f212ae0733781bb26e35a87c26073d0a769284a3d9244c81d8f4")
        assertTrue(sha.reversedArray().contentEquals(p.hash))
    }

    @Test
    fun parsesAnUnsignedCommandAndUnpackedSdReq() {
        val init = msg(varint(1, 26101702), varint(2, 51), varint(3, 0x87), varint(3, 0x81), varint(7, 10))
        val p = Firmware.parseInitPacket(msg(bytes(1, msg(varint(1, 1), bytes(2, init)))))
        assertEquals(26101702L, p.fwVersion)
        assertEquals(listOf(0x87L, 0x81L), p.sdReq)
        assertFalse(p.signed)
    }

    @Test
    fun rejectsMalformedInitPackets() {
        for (bad in listOf(byteArrayOf(), hex("128C01"), hex("FF"), logPacket.copyOf(60), hex("0802"))) {
            try {
                Firmware.parseInitPacket(bad)
                fail("accepted ${bad.toList()}")
            } catch (_: Firmware.Invalid) {
            }
        }
    }

    // ---- whole packages ----

    private val bin = ByteArray(1000) { (it * 7).toByte() }

    private fun dat(fw: Long = 26101702, type: Int = 0, size: Int = bin.size, image: ByteArray = bin): ByteArray {
        val sha = MessageDigest.getInstance("SHA-256").digest(image).reversedArray()
        val init = msg(
            varint(1, fw), varint(2, 51), bytes(3, byteArrayOf(0x87.toByte(), 0x01)), varint(4, type.toLong()),
            varint(7, size.toLong()), bytes(8, msg(varint(1, 3), bytes(2, sha))), varint(9, 0),
        )
        val command = msg(varint(1, 1), bytes(2, init))
        return msg(bytes(2, msg(bytes(1, command), varint(2, 0), bytes(3, ByteArray(64)))))
    }

    private fun zip(vararg files: Pair<String, ByteArray>): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { z ->
            for ((name, data) in files) {
                z.putNextEntry(ZipEntry(name))
                z.write(data)
                z.closeEntry()
            }
        }
        return out.toByteArray()
    }

    private val appManifest =
        """{"manifest":{"application":{"bin_file":"swet102.bin","dat_file":"swet102.dat"}}}""".toByteArray()

    private fun inspect(bytes: ByteArray) = Firmware.inspectZip(ByteArrayInputStream(bytes))

    private fun assertInvalid(bytes: ByteArray, containing: String) {
        try {
            inspect(bytes)
            fail("accepted a package that should fail with '$containing'")
        } catch (e: Firmware.Invalid) {
            assertTrue("'${e.message}' should contain '$containing'", e.message!!.contains(containing))
        }
    }

    @Test
    fun inspectsAnApplicationPackage() {
        val info = inspect(zip("manifest.json" to appManifest, "swet102.dat" to dat(), "swet102.bin" to bin))
        assertEquals(26101702L, info.init.fwVersion)
        assertEquals(listOf(0x87L), info.init.sdReq) // packed varint 87 01 = 0x87
        assertEquals(1000, info.binSize)
        assertEquals("swet102.bin", info.binFile)
    }

    @Test
    fun rejectsWhatIsNotAnApplicationPackage() {
        assertInvalid("hello".toByteArray(), "zip")
        assertInvalid(zip("readme.txt" to "hi".toByteArray()), "manifest.json")
        assertInvalid(zip("manifest.json" to "{".toByteArray()), "manifest.json")
        val sd = """{"manifest":{"softdevice_bootloader":{"bin_file":"a.bin","dat_file":"a.dat"}}}"""
        assertInvalid(zip("manifest.json" to sd.toByteArray()), "Only application")
        assertInvalid(zip("manifest.json" to appManifest, "swet102.bin" to bin), "init packet")
        assertInvalid(zip("manifest.json" to appManifest, "swet102.dat" to dat()), "firmware image")
        assertInvalid(
            zip("manifest.json" to appManifest, "swet102.dat" to dat(type = 2), "swet102.bin" to bin),
            "not for an application",
        )
        assertInvalid(
            zip("manifest.json" to appManifest, "swet102.dat" to dat(size = 999), "swet102.bin" to bin),
            "999 bytes",
        )
        val other = bin.copyOf().also { it[5] = 42 }
        assertInvalid(
            zip("manifest.json" to appManifest, "swet102.dat" to dat(image = other), "swet102.bin" to bin),
            "hash",
        )
        assertInvalid(
            zip("manifest.json" to appManifest, "swet102.dat" to "x".toByteArray(), "swet102.bin" to bin),
            "init packet",
        )
    }

    // ---- tiny protobuf writer for test vectors ----

    private fun rawVarint(v: Long): ByteArray {
        val out = ByteArrayOutputStream()
        var x = v
        while (true) {
            if (x and 0x7F.inv().toLong() == 0L) {
                out.write(x.toInt())
                return out.toByteArray()
            }
            out.write(((x and 0x7F) or 0x80).toInt())
            x = x ushr 7
        }
    }

    private fun varint(field: Int, v: Long) = rawVarint((field shl 3).toLong()) + rawVarint(v)
    private fun varint(field: Int, v: Int) = varint(field, v.toLong())
    private fun bytes(field: Int, b: ByteArray) = rawVarint(((field shl 3) or 2).toLong()) + rawVarint(b.size.toLong()) + b
    private fun msg(vararg parts: ByteArray) = parts.fold(ByteArray(0)) { a, b -> a + b }
}
