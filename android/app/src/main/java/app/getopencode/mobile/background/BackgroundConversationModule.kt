package app.getopencode.mobile.background

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import androidx.core.content.ContextCompat

class BackgroundConversationModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  init {
    BackgroundConversationEvents.attachReactContext(reactContext)
  }

  override fun getName(): String = "BackgroundConversation"

  @ReactMethod
  fun start(config: ReadableMap, promise: Promise) {
    try {
      val intent = BackgroundConversationService.createStartIntent(reactContext, config)
      ContextCompat.startForegroundService(reactContext, intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BACKGROUND_CONVERSATION_START_FAILED", error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      reactContext.startService(BackgroundConversationService.createStopIntent(reactContext))
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("BACKGROUND_CONVERSATION_STOP_FAILED", error)
    }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    try {
      promise.resolve(BackgroundConversationService.getPersistedStatus(reactContext).toWritableMap())
    } catch (error: Exception) {
      promise.reject("BACKGROUND_CONVERSATION_STATUS_FAILED", error)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // Required for NativeEventEmitter support.
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required for NativeEventEmitter support.
  }
}
