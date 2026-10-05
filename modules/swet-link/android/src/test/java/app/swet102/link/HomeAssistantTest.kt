package app.swet102.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
}
