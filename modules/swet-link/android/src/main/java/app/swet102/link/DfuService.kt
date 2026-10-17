package app.swet102.link

import android.app.Activity
import no.nordicsemi.android.dfu.DfuBaseService

/**
 * Nordic's Secure DFU service, run as a foreground service (connectedDevice)
 * while it updates the display. All the protocol work is the library's; this
 * only says where its notification leads.
 */
class DfuService : DfuBaseService() {
    /** The app's launch activity (MainActivity lives in the app, not this module). */
    override fun getNotificationTarget(): Class<out Activity>? {
        val name = packageManager.getLaunchIntentForPackage(packageName)?.component?.className ?: return null
        @Suppress("UNCHECKED_CAST")
        return runCatching { Class.forName(name) as Class<out Activity> }.getOrNull()
    }

    override fun isDebug(): Boolean = false
}
