package app.getopencode.mobile.background

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference

object BackgroundConversationEvents {
  private const val EVENT_NAME = "BackgroundConversationEvent"
  private var reactContextRef: WeakReference<ReactApplicationContext>? = null

  fun attachReactContext(reactContext: ReactApplicationContext) {
    reactContextRef = WeakReference(reactContext)
  }

  fun emitStatus(snapshot: BackgroundConversationService.Snapshot) {
    val payload = snapshot.toWritableMap().apply {
      putString("type", "status")
    }
    emit(payload)
  }

  fun emitTranscript(status: String, text: String, sessionId: String?) {
    val payload = Arguments.createMap().apply {
      putString("type", "transcript")
      putString("status", status)
      putString("text", text)
      if (sessionId != null) {
        putString("sessionId", sessionId)
      } else {
        putNull("sessionId")
      }
    }
    emit(payload)
  }

  fun emitAssistant(status: String, sessionId: String?, messageId: String?, text: String?) {
    val payload = Arguments.createMap().apply {
      putString("type", "assistant")
      putString("status", status)
      if (sessionId != null) {
        putString("sessionId", sessionId)
      } else {
        putNull("sessionId")
      }
      if (messageId != null) {
        putString("messageId", messageId)
      } else {
        putNull("messageId")
      }
      if (text != null) {
        putString("text", text)
      } else {
        putNull("text")
      }
    }
    emit(payload)
  }

  fun emitError(code: String, message: String, sessionId: String?) {
    val payload = Arguments.createMap().apply {
      putString("type", "error")
      putString("code", code)
      putString("message", message)
      if (sessionId != null) {
        putString("sessionId", sessionId)
      } else {
        putNull("sessionId")
      }
    }
    emit(payload)
  }

  private fun emit(payload: com.facebook.react.bridge.WritableMap) {
    val reactContext = reactContextRef?.get() ?: return
    if (!reactContext.hasActiveReactInstance()) {
      return
    }

    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_NAME, payload)
  }
}
