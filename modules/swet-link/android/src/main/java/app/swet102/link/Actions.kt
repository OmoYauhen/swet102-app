package app.swet102.link

import android.content.Context
import android.media.AudioManager
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.os.Build
import android.view.KeyEvent

/**
 * What the phone does for each display command. Media keys go to whichever app
 * owns the active media session (Spotify, YouTube Music, …), like a headset
 * button would; volume is the music stream.
 */
class Actions(private val context: Context) {
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    fun volume(up: Boolean) {
        audio.adjustStreamVolume(
            AudioManager.STREAM_MUSIC,
            if (up) AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER,
            AudioManager.FLAG_SHOW_UI,
        )
    }

    fun mediaKey(keyCode: Int) {
        val t = SystemClock.uptimeMillis()
        audio.dispatchMediaKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_DOWN, keyCode, 0))
        audio.dispatchMediaKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_UP, keyCode, 0))
    }

    /** The rider can't look at the phone: one short buzz = done, three = failed. */
    fun buzz(ok: Boolean) {
        val vibrator = if (Build.VERSION.SDK_INT >= 31) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        val pattern = if (ok) longArrayOf(0, 120) else longArrayOf(0, 150, 100, 150, 100, 150)
        vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
    }
}
