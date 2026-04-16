package app.getopencode.mobile.background

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import app.getopencode.mobile.MainActivity
import app.getopencode.mobile.R
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class BackgroundConversationService : Service(), TextToSpeech.OnInitListener, RecognitionListener {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val executor: ExecutorService = Executors.newSingleThreadExecutor()
  private var textToSpeech: TextToSpeech? = null
  private var speechRecognizer: SpeechRecognizer? = null
  private var toneGenerator: ToneGenerator? = null
  private var ttsReady = false
  private var recognitionAvailable = false
  private var recognitionActive = false
  private var serviceActive = false
  private var currentConfig: ServiceConfig? = null
  private var currentPhase = Phase.OFF
  private var currentLevel = 0
  private var currentStatusLabel: String? = null
  private var currentFeedback: String? = null
  private var isPolling = false
  private var isSpeaking = false
  private var currentAssistantText: String? = null
  private var awaitingAssistantReply = false
  private var awaitingAssistantReplySince = 0L

  private val pollRunnable = Runnable {
    if (!serviceActive || isPolling || isSpeaking || currentPhase == Phase.LISTENING || currentPhase == Phase.SUBMITTING) {
      schedulePoll(POLL_INTERVAL_MS)
      return@Runnable
    }

    val config = currentConfig ?: return@Runnable
    isPolling = true
    executor.execute {
      try {
        val latestReply = fetchLatestAssistantReply(config)
        if (latestReply != null && latestReply.id != config.assistantReplyBaselineId) {
          awaitingAssistantReply = false
          awaitingAssistantReplySince = 0L
          currentConfig = config.copy(assistantReplyBaselineId = latestReply.id)
          persistCurrentConfig()
          speakReply(latestReply.id, latestReply.text)
        } else {
          val statusType = fetchSessionStatus(config)
          val stillWaitingForReply = awaitingAssistantReply || (statusType != null && statusType != "idle")

          if (stillWaitingForReply) {
            maybeStartWorkingSound()
            updateRuntimeStatus(Phase.WAITING, "OpenCode is thinking", null)

            if (awaitingAssistantReply && awaitingAssistantReplySince > 0L && System.currentTimeMillis() - awaitingAssistantReplySince > REPLY_DISCOVERY_TIMEOUT_MS) {
              awaitingAssistantReply = false
              awaitingAssistantReplySince = 0L
              stopWorkingSound()
              updateRuntimeStatus(Phase.WAITING, "Still waiting for the reply", "OpenCode did not publish a finished reply yet. Returning to listening.")
              emitError("reply_timeout", "OpenCode did not publish a finished reply yet. Returning to listening.")
              if (serviceActive && config.resumeListeningAfterReply) {
                mainHandler.post { startListening() }
              }
            }
          } else {
            stopWorkingSound()
            if (serviceActive && currentPhase != Phase.LISTENING) {
              if (config.resumeListeningAfterReply) {
                mainHandler.post { startListening() }
              } else {
                updateRuntimeStatus(Phase.WAITING, "Waiting for your next turn", null)
              }
            }
          }
        }
      } catch (error: Exception) {
        stopWorkingSound()
        updateRuntimeStatus(Phase.WAITING, "Retrying background conversation", error.message ?: "Temporary background error")
        emitError("network", error.message ?: "Background polling failed.")
      } finally {
        isPolling = false
        if (serviceActive) {
          schedulePoll(POLL_INTERVAL_MS)
        }
      }
    }
  }

  private val workingSoundRunnable = object : Runnable {
    override fun run() {
      val config = currentConfig
      if (!serviceActive || currentPhase != Phase.WAITING || config == null || !config.workingSoundEnabled) {
        return
      }

      runCatching {
        val tone = ensureToneGenerator()
        val toneType = if (config.workingSoundVariant == "glass") ToneGenerator.TONE_PROP_BEEP2 else ToneGenerator.TONE_PROP_BEEP
        val duration = if (config.workingSoundVariant == "glass") 180 else 240
        tone.startTone(toneType, duration)
      }

      mainHandler.postDelayed(this, WORKING_SOUND_INTERVAL_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    textToSpeech = TextToSpeech(applicationContext, this)
    recognitionAvailable = SpeechRecognizer.isRecognitionAvailable(applicationContext)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopRuntime()
        stopSelf()
        return START_NOT_STICKY
      }

      ACTION_START -> {
        currentConfig = ServiceConfig.fromIntent(intent)
        persistCurrentConfig()
        serviceActive = true
        startForeground(NOTIFICATION_ID, buildNotification(currentStatusLabel ?: "Starting conversation", "Preparing background voice loop."))
        BackgroundConversationEvents.emitStatus(snapshot())
        mainHandler.post {
          if (!ttsReady) {
            updateRuntimeStatus(Phase.WAITING, "Preparing speech", null)
          } else {
            startListening()
          }
        }
      }
    }

    return START_STICKY
  }

  override fun onDestroy() {
    stopRuntime()
    executor.shutdownNow()
    super.onDestroy()
  }

  override fun onInit(status: Int) {
    ttsReady = status == TextToSpeech.SUCCESS
    textToSpeech?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) {
        isSpeaking = true
        stopWorkingSound()
        updateRuntimeStatus(Phase.SPEAKING, "Speaking reply", null)
        currentAssistantText?.let { BackgroundConversationEvents.emitAssistant("started", currentConfig?.sessionId, null, it) }
      }

      override fun onDone(utteranceId: String?) {
        isSpeaking = false
        val config = currentConfig
        BackgroundConversationEvents.emitAssistant("finished", config?.sessionId, config?.assistantReplyBaselineId, currentAssistantText)
        currentAssistantText = null
        awaitingAssistantReply = false
        awaitingAssistantReplySince = 0L
        if (serviceActive && config?.resumeListeningAfterReply == true) {
          mainHandler.postDelayed({ startListening() }, POST_TTS_LISTEN_DELAY_MS)
        } else {
          updateRuntimeStatus(Phase.WAITING, "Waiting for your next turn", null)
        }
      }

      @Deprecated("Deprecated in Java")
      override fun onError(utteranceId: String?) {
        onError(utteranceId, TextToSpeech.ERROR)
      }

      override fun onError(utteranceId: String?, errorCode: Int) {
        isSpeaking = false
        currentAssistantText = null
        updateRuntimeStatus(Phase.WAITING, "Reply playback failed", "Android text-to-speech could not play the reply.")
        emitError("tts", "Android text-to-speech could not play the reply.")
        if (serviceActive && currentConfig?.resumeListeningAfterReply == true) {
          mainHandler.postDelayed({ startListening() }, RECOVERY_DELAY_MS)
        }
      }
    })

    if (serviceActive && currentPhase == Phase.WAITING) {
      mainHandler.post { startListening() }
    }
  }

  override fun onReadyForSpeech(params: Bundle?) {
    recognitionActive = true
    updateRuntimeStatus(Phase.LISTENING, "Listening in background", null)
  }

  override fun onBeginningOfSpeech() {
    updateRuntimeStatus(Phase.LISTENING, "Listening in background", null)
  }

  override fun onRmsChanged(rmsdB: Float) {
    val normalized = ((rmsdB + 2f) * 1.2f).toInt().coerceIn(0, 10)
    if (normalized == currentLevel) {
      return
    }

    currentLevel = normalized
    persistSnapshot()
    BackgroundConversationEvents.emitStatus(snapshot())
  }

  override fun onBufferReceived(buffer: ByteArray?) = Unit

  override fun onEndOfSpeech() {
    recognitionActive = false
    currentLevel = 0
    persistSnapshot()
    BackgroundConversationEvents.emitStatus(snapshot())
  }

  override fun onError(error: Int) {
    recognitionActive = false
    currentLevel = 0
    when (error) {
      SpeechRecognizer.ERROR_NO_MATCH,
      SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
      SpeechRecognizer.ERROR_CLIENT,
      SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> {
        if (serviceActive && !isSpeaking) {
          updateRuntimeStatus(Phase.WAITING, "Still listening for you", null)
          mainHandler.postDelayed({ startListening() }, RECOVERY_DELAY_MS)
        }
      }

      else -> {
        val message = recognitionErrorMessage(error)
        updateRuntimeStatus(Phase.WAITING, "Voice input interrupted", message)
        emitError("stt", message)
        if (serviceActive && !isSpeaking) {
          mainHandler.postDelayed({ startListening() }, RECOVERY_DELAY_MS)
        }
      }
    }
  }

  override fun onResults(results: Bundle?) {
    recognitionActive = false
    currentLevel = 0
    val transcript = extractTranscript(results)
    if (transcript.isBlank()) {
      if (serviceActive) {
        mainHandler.postDelayed({ startListening() }, RECOVERY_DELAY_MS)
      }
      return
    }

    BackgroundConversationEvents.emitTranscript("final", transcript, currentConfig?.sessionId)
    submitPrompt(transcript)
  }

  override fun onPartialResults(partialResults: Bundle?) {
    val transcript = extractTranscript(partialResults)
    if (transcript.isNotBlank()) {
      BackgroundConversationEvents.emitTranscript("partial", transcript, currentConfig?.sessionId)
    }
  }

  override fun onEvent(eventType: Int, params: Bundle?) = Unit

  private fun startListening() {
    val config = currentConfig
    if (!serviceActive || config == null || isSpeaking) {
      return
    }

    if (!ttsReady) {
      updateRuntimeStatus(Phase.WAITING, "Preparing speech", null)
      return
    }

    if (!recognitionAvailable) {
      updateRuntimeStatus(Phase.WAITING, "Voice input unavailable", "Android speech recognition is not available on this device.")
      emitError("stt_unavailable", "Android speech recognition is not available on this device.")
      return
    }

    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      updateRuntimeStatus(Phase.WAITING, "Microphone permission required", "Enable microphone access to continue background conversation.")
      emitError("permission", "Enable microphone access to continue background conversation.")
      return
    }

    stopWorkingSound()
    stopPolling()
    val recognizer = ensureSpeechRecognizer() ?: run {
      updateRuntimeStatus(Phase.WAITING, "Voice input unavailable", "Could not start Android speech recognition.")
      emitError("stt_unavailable", "Could not start Android speech recognition.")
      return
    }

    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, config.speechLocale ?: Locale.getDefault().toLanguageTag())
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, config.preferOnDeviceRecognition)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, config.preferOnDeviceRecognition)
      }
    }

    try {
      recognizer.cancel()
      recognizer.startListening(intent)
      updateRuntimeStatus(Phase.LISTENING, "Listening in background", null)
    } catch (error: Exception) {
      updateRuntimeStatus(Phase.WAITING, "Voice input failed", error.message ?: "Could not start Android speech recognition.")
      emitError("stt_start_failed", error.message ?: "Could not start Android speech recognition.")
      mainHandler.postDelayed({ startListening() }, RECOVERY_DELAY_MS)
    }
  }

  private fun ensureSpeechRecognizer(): SpeechRecognizer? {
    if (!recognitionAvailable) {
      return null
    }

    if (speechRecognizer == null) {
      speechRecognizer = SpeechRecognizer.createSpeechRecognizer(applicationContext).also {
        it.setRecognitionListener(this)
      }
    }

    return speechRecognizer
  }

  private fun submitPrompt(transcript: String) {
    val config = currentConfig ?: return
    updateRuntimeStatus(Phase.SUBMITTING, "Sending your turn", null)
    awaitingAssistantReply = true
    awaitingAssistantReplySince = System.currentTimeMillis()
    stopWorkingSound()
    executor.execute {
      try {
        postPrompt(config, transcript)
        updateRuntimeStatus(Phase.WAITING, "OpenCode is thinking", null)
        maybeStartWorkingSound()
        schedulePoll(POST_SUBMIT_POLL_DELAY_MS)
      } catch (error: Exception) {
        awaitingAssistantReply = false
        awaitingAssistantReplySince = 0L
        val message = error.message ?: "Voice conversation failed while sending your message."
        updateRuntimeStatus(Phase.WAITING, "Could not send your turn", message)
        emitError("submit", message)
        if (serviceActive) {
          mainHandler.postDelayed({ startListening() }, RECOVERY_DELAY_MS)
        }
      }
    }
  }

  private fun postPrompt(config: ServiceConfig, transcript: String) {
    val body = JSONObject().apply {
      put("agent", config.agent)
      config.model?.let {
        put(
          "model",
          JSONObject().apply {
            put("providerID", it.providerID)
            put("modelID", it.modelID)
          },
        )
      }
      config.system?.takeIf { it.isNotBlank() }?.let { put("system", it) }
      put(
        "parts",
        JSONArray().put(
          JSONObject().apply {
            put("type", "text")
            put("text", transcript.trim())
          },
        ),
      )
    }

    requestJson(config, "/session/${config.sessionId}/message", method = "POST", body = body)
  }

  private fun fetchSessionStatus(config: ServiceConfig): String? {
    val payload = requestJson(config, "/session/status") ?: return null
    return payload.optJSONObject("data")?.optJSONObject(config.sessionId)?.optString("type")
  }

  private fun fetchLatestAssistantReply(config: ServiceConfig): AssistantReply? {
    val payload = requestJson(config, "/session/${config.sessionId}/message") ?: return null
    val records = payload.optJSONArray("data") ?: return null

    for (index in records.length() - 1 downTo 0) {
      val record = records.optJSONObject(index) ?: continue
      val info = record.optJSONObject("info") ?: continue
      if (info.optString("role") != "assistant") {
        continue
      }

      val parts = record.optJSONArray("parts") ?: continue
      val text = extractReadableText(parts)
      if (text.isNotBlank()) {
        return AssistantReply(info.optString("id"), text)
      }
    }

    return null
  }

  private fun extractReadableText(parts: JSONArray): String {
    val chunks = mutableListOf<String>()
    for (partIndex in 0 until parts.length()) {
      val part = parts.optJSONObject(partIndex) ?: continue
      val type = part.optString("type")
      if (type == "text" || type == "reasoning") {
        val text = part.optString("text").trim()
        if (text.isNotEmpty()) {
          chunks.add(text)
        }
      }
    }
    return chunks.joinToString("\n\n").trim()
  }

  private fun speakReply(messageId: String, text: String) {
    val config = currentConfig
    val engine = textToSpeech
    if (!serviceActive || config == null || !ttsReady || engine == null || text.isBlank()) {
      return
    }

    stopWorkingSound()
    stopListening()

    config.speechLocale?.let {
      parseLocale(it)?.let { locale -> engine.language = locale }
    }
    config.speechVoiceId?.let { voiceId ->
      val selectedVoice = engine.voices?.firstOrNull { it.name == voiceId || it.toString() == voiceId }
      if (selectedVoice != null) {
        engine.voice = selectedVoice
      }
    }

    engine.setSpeechRate(config.speechRate.toFloat().coerceIn(0.5f, 1.5f))
    currentAssistantText = compactWhitespace(text)
    awaitingAssistantReply = false
    awaitingAssistantReplySince = 0L
    updateRuntimeStatus(Phase.SPEAKING, "Speaking reply", null)
    engine.speak(currentAssistantText, TextToSpeech.QUEUE_FLUSH, null, UUID.randomUUID().toString())
    currentConfig = config.copy(assistantReplyBaselineId = messageId)
    persistCurrentConfig()
  }

  private fun requestJson(config: ServiceConfig, path: String, method: String = "GET", body: JSONObject? = null): JSONObject? {
    val url = buildUrl(config, path)
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      requestMethod = method
      connectTimeout = 15_000
      readTimeout = 30_000
      setRequestProperty("Accept", "application/json")
      setRequestProperty("Content-Type", "application/json")
      config.authHeader?.let { setRequestProperty("Authorization", it) }
      doInput = true
      if (body != null) {
        doOutput = true
      }
    }

    return try {
      if (body != null) {
        connection.outputStream.use { output ->
          output.write(body.toString().toByteArray(StandardCharsets.UTF_8))
        }
      }

      if (connection.responseCode !in 200..299) {
        val errorBody = runCatching {
          BufferedReader(InputStreamReader(connection.errorStream ?: connection.inputStream)).use { it.readText() }
        }.getOrNull()
        throw IllegalStateException(errorBody?.takeIf { it.isNotBlank() } ?: "OpenCode request failed: ${connection.responseCode}")
      }

      BufferedReader(InputStreamReader(connection.inputStream)).use { reader ->
        val responseBody = reader.readText()
        if (responseBody.isBlank()) null else JSONObject(responseBody)
      }
    } finally {
      connection.disconnect()
    }
  }

  private fun buildUrl(config: ServiceConfig, path: String): String {
    val separator = if (path.contains("?")) '&' else '?'
    val encodedDirectory = URLEncoder.encode(config.directory, StandardCharsets.UTF_8.toString())
    return "${config.serverUrl.trimEnd('/')}$path${separator}directory=$encodedDirectory"
  }

  private fun maybeStartWorkingSound() {
    val config = currentConfig ?: return
    if (!config.workingSoundEnabled || currentPhase != Phase.WAITING || isSpeaking || recognitionActive) {
      return
    }

    mainHandler.removeCallbacks(workingSoundRunnable)
    mainHandler.post(workingSoundRunnable)
  }

  private fun stopWorkingSound() {
    mainHandler.removeCallbacks(workingSoundRunnable)
    toneGenerator?.stopTone()
  }

  private fun ensureToneGenerator(): ToneGenerator {
    if (toneGenerator == null) {
      val config = currentConfig
      val volumePercent = (((config?.workingSoundVolume ?: 0.18) * 100).toInt()).coerceIn(5, 70)
      toneGenerator = ToneGenerator(AudioManager.STREAM_MUSIC, volumePercent)
    }

    return toneGenerator as ToneGenerator
  }

  private fun stopListening() {
    recognitionActive = false
    currentLevel = 0
    runCatching { speechRecognizer?.cancel() }
    persistSnapshot()
    BackgroundConversationEvents.emitStatus(snapshot())
  }

  private fun schedulePoll(delayMs: Long) {
    mainHandler.removeCallbacks(pollRunnable)
    if (serviceActive) {
      mainHandler.postDelayed(pollRunnable, delayMs)
    }
  }

  private fun stopPolling() {
    mainHandler.removeCallbacks(pollRunnable)
    isPolling = false
  }

  private fun stopRuntime() {
    serviceActive = false
    stopPolling()
    stopWorkingSound()
    stopListening()
    speechRecognizer?.destroy()
    speechRecognizer = null
    textToSpeech?.stop()
    textToSpeech?.shutdown()
    textToSpeech = null
    toneGenerator?.release()
    toneGenerator = null
    currentAssistantText = null
    isSpeaking = false
    awaitingAssistantReply = false
    awaitingAssistantReplySince = 0L
    recognitionAvailable = SpeechRecognizer.isRecognitionAvailable(applicationContext)
    updateRuntimeStatus(Phase.OFF, null, null)
    currentConfig = null
    clearPersistedConfig()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }

  private fun updateRuntimeStatus(phase: Phase, label: String?, feedback: String?) {
    currentPhase = phase
    currentStatusLabel = label
    currentFeedback = feedback
    if (phase != Phase.LISTENING) {
      currentLevel = 0
    }
    persistSnapshot()
    BackgroundConversationEvents.emitStatus(snapshot())
    val notificationText = feedback ?: label ?: "Background conversation ready"
    val title = when (phase) {
      Phase.OFF -> "Conversation stopped"
      Phase.LISTENING -> "Listening in background"
      Phase.SUBMITTING -> "Sending your turn"
      Phase.WAITING -> label ?: "OpenCode is thinking"
      Phase.SPEAKING -> "Speaking reply"
    }
    val manager = getSystemService(NotificationManager::class.java)
    manager.notify(NOTIFICATION_ID, buildNotification(title, notificationText))
  }

  private fun emitError(code: String, message: String) {
    BackgroundConversationEvents.emitError(code, message, currentConfig?.sessionId)
  }

  private fun extractTranscript(bundle: Bundle?): String {
    val matches = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: return ""
    return matches.firstOrNull()?.trim().orEmpty()
  }

  private fun recognitionErrorMessage(code: Int): String {
    return when (code) {
      SpeechRecognizer.ERROR_AUDIO -> "Background voice input hit an audio error."
      SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone or speech recognition permission was denied."
      SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Android speech recognition hit a network error."
      SpeechRecognizer.ERROR_NO_MATCH -> "No speech detected."
      SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Android speech recognition is busy."
      SpeechRecognizer.ERROR_SERVER -> "Android speech recognition hit a server error."
      SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Listening timed out before speech was detected."
      else -> "Android speech recognition failed."
    }
  }

  private fun buildNotification(title: String, text: String): Notification {
    val openIntent = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      },
      PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
    )
    val stopIntent = PendingIntent.getService(
      this,
      1,
      createStopIntent(this),
      PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(title)
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setContentIntent(openIntent)
      .addAction(0, "Stop", stopIntent)
      .setOngoing(serviceActive)
      .setOnlyAlertOnce(true)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val manager = getSystemService(NotificationManager::class.java)
    val audioAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    val channel = NotificationChannel(CHANNEL_ID, "Background conversation", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Keeps OpenCode conversation active while Android allows background execution."
      setSound(null, audioAttributes)
    }
    manager.createNotificationChannel(channel)
  }

  private fun parseLocale(value: String): Locale? {
    val sanitized = value.replace('_', '-')
    return runCatching { Locale.forLanguageTag(sanitized) }.getOrNull()
  }

  private fun compactWhitespace(value: String): String {
    return value.replace(Regex("\\s+"), " ").trim()
  }

  private fun immutableFlag(): Int {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
  }

  private fun prefs() = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun persistCurrentConfig() {
    val config = currentConfig ?: return
    prefs().edit()
      .putString(KEY_SERVER_URL, config.serverUrl)
      .putString(KEY_USERNAME, config.username)
      .putString(KEY_PASSWORD, config.password)
      .putString(KEY_DIRECTORY, config.directory)
      .putString(KEY_SESSION_ID, config.sessionId)
      .putString(KEY_AGENT, config.agent)
      .putString(KEY_SYSTEM, config.system)
      .putString(KEY_SPEECH_LOCALE, config.speechLocale)
      .putFloat(KEY_SPEECH_RATE, config.speechRate.toFloat())
      .putString(KEY_SPEECH_VOICE_ID, config.speechVoiceId)
      .putString(KEY_ASSISTANT_REPLY_BASELINE_ID, config.assistantReplyBaselineId)
      .putBoolean(KEY_PREFER_ON_DEVICE, config.preferOnDeviceRecognition)
      .putBoolean(KEY_RESUME_LISTENING, config.resumeListeningAfterReply)
      .putBoolean(KEY_WORKING_SOUND_ENABLED, config.workingSoundEnabled)
      .putString(KEY_WORKING_SOUND_VARIANT, config.workingSoundVariant)
      .putFloat(KEY_WORKING_SOUND_VOLUME, config.workingSoundVolume.toFloat())
      .putString(KEY_MODEL_PROVIDER_ID, config.model?.providerID)
      .putString(KEY_MODEL_ID, config.model?.modelID)
      .apply()
  }

  private fun clearPersistedConfig() {
    prefs().edit()
      .remove(KEY_SERVER_URL)
      .remove(KEY_USERNAME)
      .remove(KEY_PASSWORD)
      .remove(KEY_DIRECTORY)
      .remove(KEY_SESSION_ID)
      .remove(KEY_AGENT)
      .remove(KEY_SYSTEM)
      .remove(KEY_SPEECH_LOCALE)
      .remove(KEY_SPEECH_RATE)
      .remove(KEY_SPEECH_VOICE_ID)
      .remove(KEY_ASSISTANT_REPLY_BASELINE_ID)
      .remove(KEY_PREFER_ON_DEVICE)
      .remove(KEY_RESUME_LISTENING)
      .remove(KEY_WORKING_SOUND_ENABLED)
      .remove(KEY_WORKING_SOUND_VARIANT)
      .remove(KEY_WORKING_SOUND_VOLUME)
      .remove(KEY_MODEL_PROVIDER_ID)
      .remove(KEY_MODEL_ID)
      .apply()
  }

  private fun persistSnapshot() {
    prefs().edit()
      .putBoolean(KEY_ACTIVE, serviceActive)
      .putString(KEY_PHASE, currentPhase.value)
      .putString(KEY_STATUS_LABEL, currentStatusLabel)
      .putString(KEY_FEEDBACK, currentFeedback)
      .putInt(KEY_LEVEL, currentLevel)
      .putString(KEY_SESSION_ID, currentConfig?.sessionId)
      .apply()
  }

  private fun snapshot(): Snapshot {
    return Snapshot(
      active = serviceActive,
      phase = currentPhase.value,
      sessionId = currentConfig?.sessionId,
      level = currentLevel,
      statusLabel = currentStatusLabel,
      feedback = currentFeedback,
    )
  }

  enum class Phase(val value: String) {
    OFF("off"),
    LISTENING("listening"),
    SUBMITTING("submitting"),
    WAITING("waiting"),
    SPEAKING("speaking"),
  }

  data class ModelConfig(
    val providerID: String,
    val modelID: String,
  )

  data class AssistantReply(val id: String, val text: String)

  data class Snapshot(
    val active: Boolean,
    val phase: String,
    val sessionId: String?,
    val level: Int,
    val statusLabel: String?,
    val feedback: String?,
  ) {
    fun toWritableMap(): WritableMap {
      return Arguments.createMap().apply {
        putBoolean("active", active)
        putString("phase", phase)
        if (sessionId != null) {
          putString("sessionId", sessionId)
        } else {
          putNull("sessionId")
        }
        putInt("level", level)
        if (statusLabel != null) {
          putString("statusLabel", statusLabel)
        } else {
          putNull("statusLabel")
        }
        if (feedback != null) {
          putString("feedback", feedback)
        } else {
          putNull("feedback")
        }
      }
    }
  }

  data class ServiceConfig(
    val serverUrl: String,
    val username: String,
    val password: String,
    val directory: String,
    val sessionId: String,
    val agent: String,
    val model: ModelConfig?,
    val system: String?,
    val speechLocale: String?,
    val speechRate: Double,
    val speechVoiceId: String?,
    val assistantReplyBaselineId: String?,
    val preferOnDeviceRecognition: Boolean,
    val resumeListeningAfterReply: Boolean,
    val workingSoundEnabled: Boolean,
    val workingSoundVariant: String,
    val workingSoundVolume: Double,
  ) {
    val authHeader: String?
      get() {
        if (password.isBlank()) {
          return null
        }
        val safeUsername = if (username.isBlank()) "opencode" else username
        val token = android.util.Base64.encodeToString("$safeUsername:$password".toByteArray(), android.util.Base64.NO_WRAP)
        return "Basic $token"
      }

    companion object {
      fun fromIntent(intent: Intent): ServiceConfig {
        return ServiceConfig(
          serverUrl = intent.getStringExtra(EXTRA_SERVER_URL).orEmpty(),
          username = intent.getStringExtra(EXTRA_USERNAME).orEmpty(),
          password = intent.getStringExtra(EXTRA_PASSWORD).orEmpty(),
          directory = intent.getStringExtra(EXTRA_DIRECTORY).orEmpty(),
          sessionId = intent.getStringExtra(EXTRA_SESSION_ID).orEmpty(),
          agent = intent.getStringExtra(EXTRA_AGENT).orEmpty(),
          model = modelFromIntent(intent),
          system = intent.getStringExtra(EXTRA_SYSTEM),
          speechLocale = intent.getStringExtra(EXTRA_SPEECH_LOCALE),
          speechRate = intent.getDoubleExtra(EXTRA_SPEECH_RATE, 1.0),
          speechVoiceId = intent.getStringExtra(EXTRA_SPEECH_VOICE_ID),
          assistantReplyBaselineId = intent.getStringExtra(EXTRA_ASSISTANT_REPLY_BASELINE_ID),
          preferOnDeviceRecognition = intent.getBooleanExtra(EXTRA_PREFER_ON_DEVICE, true),
          resumeListeningAfterReply = intent.getBooleanExtra(EXTRA_RESUME_LISTENING, true),
          workingSoundEnabled = intent.getBooleanExtra(EXTRA_WORKING_SOUND_ENABLED, false),
          workingSoundVariant = intent.getStringExtra(EXTRA_WORKING_SOUND_VARIANT) ?: "soft",
          workingSoundVolume = intent.getDoubleExtra(EXTRA_WORKING_SOUND_VOLUME, 0.18),
        )
      }

      private fun modelFromIntent(intent: Intent): ModelConfig? {
        val providerID = intent.getStringExtra(EXTRA_MODEL_PROVIDER_ID)
        val modelID = intent.getStringExtra(EXTRA_MODEL_ID)
        if (providerID.isNullOrBlank() || modelID.isNullOrBlank()) {
          return null
        }

        return ModelConfig(providerID = providerID, modelID = modelID)
      }
    }
  }

  companion object {
    private const val ACTION_START = "app.getopencode.mobile.background.START"
    private const val ACTION_STOP = "app.getopencode.mobile.background.STOP"
    private const val CHANNEL_ID = "background-conversation"
    private const val NOTIFICATION_ID = 4106
    private const val POLL_INTERVAL_MS = 2500L
    private const val POST_SUBMIT_POLL_DELAY_MS = 1200L
    private const val POST_TTS_LISTEN_DELAY_MS = 500L
    private const val RECOVERY_DELAY_MS = 900L
    private const val WORKING_SOUND_INTERVAL_MS = 1800L
    private const val REPLY_DISCOVERY_TIMEOUT_MS = 120_000L
    private const val PREFS_NAME = "background_conversation"
    private const val EXTRA_SERVER_URL = "serverUrl"
    private const val EXTRA_USERNAME = "username"
    private const val EXTRA_PASSWORD = "password"
    private const val EXTRA_DIRECTORY = "directory"
    private const val EXTRA_SESSION_ID = "sessionId"
    private const val EXTRA_AGENT = "agent"
    private const val EXTRA_SYSTEM = "system"
    private const val EXTRA_SPEECH_LOCALE = "speechLocale"
    private const val EXTRA_SPEECH_RATE = "speechRate"
    private const val EXTRA_SPEECH_VOICE_ID = "speechVoiceId"
    private const val EXTRA_ASSISTANT_REPLY_BASELINE_ID = "assistantReplyBaselineId"
    private const val EXTRA_MODEL_PROVIDER_ID = "modelProviderID"
    private const val EXTRA_MODEL_ID = "modelID"
    private const val EXTRA_PREFER_ON_DEVICE = "preferOnDeviceRecognition"
    private const val EXTRA_RESUME_LISTENING = "resumeListeningAfterReply"
    private const val EXTRA_WORKING_SOUND_ENABLED = "workingSoundEnabled"
    private const val EXTRA_WORKING_SOUND_VARIANT = "workingSoundVariant"
    private const val EXTRA_WORKING_SOUND_VOLUME = "workingSoundVolume"
    private const val KEY_ACTIVE = "active"
    private const val KEY_PHASE = "phase"
    private const val KEY_STATUS_LABEL = "statusLabel"
    private const val KEY_FEEDBACK = "feedback"
    private const val KEY_LEVEL = "level"
    private const val KEY_SERVER_URL = "serverUrl"
    private const val KEY_USERNAME = "username"
    private const val KEY_PASSWORD = "password"
    private const val KEY_DIRECTORY = "directory"
    private const val KEY_SESSION_ID = "sessionId"
    private const val KEY_AGENT = "agent"
    private const val KEY_SYSTEM = "system"
    private const val KEY_SPEECH_LOCALE = "speechLocale"
    private const val KEY_SPEECH_RATE = "speechRate"
    private const val KEY_SPEECH_VOICE_ID = "speechVoiceId"
    private const val KEY_ASSISTANT_REPLY_BASELINE_ID = "assistantReplyBaselineId"
    private const val KEY_MODEL_PROVIDER_ID = "modelProviderID"
    private const val KEY_MODEL_ID = "modelID"
    private const val KEY_PREFER_ON_DEVICE = "preferOnDeviceRecognition"
    private const val KEY_RESUME_LISTENING = "resumeListeningAfterReply"
    private const val KEY_WORKING_SOUND_ENABLED = "workingSoundEnabled"
    private const val KEY_WORKING_SOUND_VARIANT = "workingSoundVariant"
    private const val KEY_WORKING_SOUND_VOLUME = "workingSoundVolume"

    fun createStartIntent(context: Context, config: ReadableMap): Intent {
      return Intent(context, BackgroundConversationService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_SERVER_URL, config.getString(EXTRA_SERVER_URL))
        putExtra(EXTRA_USERNAME, config.getString(EXTRA_USERNAME))
        putExtra(EXTRA_PASSWORD, config.getString(EXTRA_PASSWORD))
        putExtra(EXTRA_DIRECTORY, config.getString(EXTRA_DIRECTORY))
        putExtra(EXTRA_SESSION_ID, config.getString(EXTRA_SESSION_ID))
        putExtra(EXTRA_AGENT, config.getString(EXTRA_AGENT))
        putExtra(EXTRA_SYSTEM, if (config.hasKey(EXTRA_SYSTEM)) config.getString(EXTRA_SYSTEM) else null)
        putExtra(EXTRA_SPEECH_LOCALE, if (config.hasKey(EXTRA_SPEECH_LOCALE)) config.getString(EXTRA_SPEECH_LOCALE) else null)
        putExtra(EXTRA_SPEECH_RATE, if (config.hasKey(EXTRA_SPEECH_RATE)) config.getDouble(EXTRA_SPEECH_RATE) else 1.0)
        putExtra(EXTRA_SPEECH_VOICE_ID, if (config.hasKey(EXTRA_SPEECH_VOICE_ID)) config.getString(EXTRA_SPEECH_VOICE_ID) else null)
        putExtra(
          EXTRA_ASSISTANT_REPLY_BASELINE_ID,
          if (config.hasKey(EXTRA_ASSISTANT_REPLY_BASELINE_ID)) config.getString(EXTRA_ASSISTANT_REPLY_BASELINE_ID) else null,
        )
        putExtra(EXTRA_PREFER_ON_DEVICE, config.hasKey(EXTRA_PREFER_ON_DEVICE) && config.getBoolean(EXTRA_PREFER_ON_DEVICE))
        putExtra(EXTRA_RESUME_LISTENING, !config.hasKey(EXTRA_RESUME_LISTENING) || config.getBoolean(EXTRA_RESUME_LISTENING))
        putExtra(EXTRA_WORKING_SOUND_ENABLED, config.hasKey(EXTRA_WORKING_SOUND_ENABLED) && config.getBoolean(EXTRA_WORKING_SOUND_ENABLED))
        putExtra(EXTRA_WORKING_SOUND_VARIANT, if (config.hasKey(EXTRA_WORKING_SOUND_VARIANT)) config.getString(EXTRA_WORKING_SOUND_VARIANT) else "soft")
        putExtra(EXTRA_WORKING_SOUND_VOLUME, if (config.hasKey(EXTRA_WORKING_SOUND_VOLUME)) config.getDouble(EXTRA_WORKING_SOUND_VOLUME) else 0.18)

        if (config.hasKey("model") && config.getType("model") == ReadableType.Map) {
          val model = config.getMap("model")
          putExtra(EXTRA_MODEL_PROVIDER_ID, model?.getString("providerID"))
          putExtra(EXTRA_MODEL_ID, model?.getString("modelID"))
        }
      }
    }

    fun createStopIntent(context: Context): Intent {
      return Intent(context, BackgroundConversationService::class.java).apply {
        action = ACTION_STOP
      }
    }

    fun getPersistedStatus(context: Context): Snapshot {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      return Snapshot(
        active = prefs.getBoolean(KEY_ACTIVE, false),
        phase = prefs.getString(KEY_PHASE, Phase.OFF.value) ?: Phase.OFF.value,
        sessionId = prefs.getString(KEY_SESSION_ID, null),
        level = prefs.getInt(KEY_LEVEL, 0),
        statusLabel = prefs.getString(KEY_STATUS_LABEL, null),
        feedback = prefs.getString(KEY_FEEDBACK, null),
      )
    }
  }
}
