package app.swet102.link

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Brings the link back after a phone restart (or an app update) if it was on. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val s = Settings(context)
        if (s.enabled && s.address != null) SwetLinkService.start(context)
    }
}
