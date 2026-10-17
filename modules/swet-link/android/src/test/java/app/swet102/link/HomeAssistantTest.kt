package app.swet102.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeAssistantTest {
    private val gate = HomeAssistant.Gate("button.press", "button.gate_a")

    @Test
    fun buildsAServiceCall() {
        val (req, problem) = HomeAssistant.request("https://ha.example:8123/", " tok ", gate)
        assertNull(problem)
        assertEquals("https://ha.example:8123/api/services/button/press", req!!.url)
        assertEquals("tok", req.token)
        assertEquals("{\"entity_id\":\"button.gate_a\"}", req.body)
    }

    @Test
    fun explainsMissingSettings() {
        assertEquals("no Home Assistant URL", HomeAssistant.request("", "t", gate).second)
        assertEquals("URL must start with http:// or https://", HomeAssistant.request("ha.local", "t", gate).second)
        assertEquals("no access token", HomeAssistant.request("http://ha", " ", gate).second)
        assertEquals(
            "service must look like domain.service",
            HomeAssistant.request("http://ha", "t", HomeAssistant.Gate("press", "x")).second,
        )
        assertEquals("no entity", HomeAssistant.request("http://ha", "t", HomeAssistant.Gate("button.press", "")).second)
    }

    @Test
    fun buildsAnInputNumberSetValue() {
        val (soc, problem) = HomeAssistant.setValue("http://ha:8123/", "tok", "input_number.e_bike_battery_soc_raw", 72)
        assertNull(problem)
        assertEquals("http://ha:8123/api/services/input_number/set_value", soc!!.url)
        assertEquals("{\"entity_id\":\"input_number.e_bike_battery_soc_raw\",\"value\":72}", soc.body)
        val (volts, _) = HomeAssistant.setValue("http://ha:8123", "tok", " input_number.v ", 52.3)
        assertEquals("{\"entity_id\":\"input_number.v\",\"value\":52.3}", volts!!.body)
        assertEquals("no entity", HomeAssistant.setValue("http://ha", "t", " ", 1).second)
        assertEquals("no access token", HomeAssistant.setValue("http://ha", "", "x", 1).second)
    }

    @Test
    fun throttlesToChangesOncePerInterval() {
        val t = HomeAssistant.Throttle(60_000, 0.1)
        assertTrue(t.offer(52.3, 0)) // first after connect
        assertFalse(t.offer(52.3, 61_000)) // unchanged
        assertFalse(t.offer(52.2, 30_000)) // too soon
        assertTrue(t.offer(52.2, 61_000))
        assertFalse(t.offer(52.25, 130_000)) // under 0.1 V
        t.reset()
        assertTrue(t.offer(52.2, 130_001)) // a new connection sends at once
        t.failed()
        assertFalse(t.offer(52.2, 140_000)) // a retry still waits for the interval
        assertTrue(t.offer(52.2, 190_001)) // then goes out unchanged
    }
}
