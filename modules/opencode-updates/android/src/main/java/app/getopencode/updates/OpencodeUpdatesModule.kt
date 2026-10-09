package app.getopencode.updates

import android.app.Activity
import android.content.pm.ApplicationInfo
import android.os.Build
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val UPDATE_REQUEST = 27491

class OpencodeUpdatesModule : Module() {
  private var manager: AppUpdateManager? = null
  private var consent: Promise? = null
  private var downloaded = false
  private var destroyed = false

  private fun supported(): Boolean {
    val context = appContext.reactContext ?: return false
    if (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) return false
    return try {
      val installer = if (Build.VERSION.SDK_INT >= 30) {
        context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName
      } else {
        @Suppress("DEPRECATION")
        context.packageManager.getInstallerPackageName(context.packageName)
      }
      installer == "com.android.vending"
    } catch (_: Exception) { false }
  }

  private val listener = InstallStateUpdatedListener { state ->
    if (destroyed) return@InstallStateUpdatedListener
    downloaded = state.installStatus() == InstallStatus.DOWNLOADED
    when (state.installStatus()) {
      InstallStatus.DOWNLOADED -> sendEvent("status", mapOf("phase" to "downloaded"))
      InstallStatus.DOWNLOADING, InstallStatus.PENDING -> sendEvent("status", mapOf("phase" to "downloading"))
      InstallStatus.CANCELED -> sendEvent("status", mapOf("phase" to "cancelled"))
      InstallStatus.FAILED -> sendEvent("status", mapOf("phase" to "failed"))
      InstallStatus.INSTALLING -> sendEvent("status", mapOf("phase" to "installing"))
      InstallStatus.INSTALLED -> sendEvent("status", mapOf("phase" to "none"))
    }
    // Completion is only allowed through the user's explicit completeUpdate call.
  }

  private fun updateManager(): AppUpdateManager {
    check(!destroyed)
    return manager ?: AppUpdateManagerFactory.create(requireNotNull(appContext.reactContext)).also {
      it.registerListener(listener)
      manager = it
    }
  }

  private fun snapshot(info: AppUpdateInfo): Map<String, Any?> {
    downloaded = info.installStatus() == InstallStatus.DOWNLOADED
    val phase = when (info.installStatus()) {
      InstallStatus.DOWNLOADED -> "downloaded"
      InstallStatus.DOWNLOADING, InstallStatus.PENDING -> "downloading"
      InstallStatus.INSTALLING -> "installing"
      else -> if (info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE &&
        info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) "available" else "none"
    }
    return mapOf("phase" to phase, "version" to info.availableVersionCode().takeIf { it > 0 }?.toString())
  }

  override fun definition() = ModuleDefinition {
    Name("OpencodeUpdates")
    Events("status")

    AsyncFunction("check") { promise: Promise ->
      if (!supported()) { promise.resolve(mapOf("phase" to "none")); return@AsyncFunction }
      updateManager().appUpdateInfo.addOnSuccessListener {
        if (destroyed) promise.reject("UPDATE_CLOSED", "The update module was closed.", null)
        else promise.resolve(snapshot(it))
      }.addOnFailureListener { promise.reject("UPDATE_CHECK_FAILED", it.message, it) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("startFlexibleUpdate") { promise: Promise ->
      if (!supported()) { promise.resolve(false); return@AsyncFunction }
      if (consent != null) { promise.reject("UPDATE_BUSY", "An update confirmation is already open.", null); return@AsyncFunction }
      consent = promise
      updateManager().appUpdateInfo.addOnSuccessListener { info ->
        if (destroyed || consent !== promise) return@addOnSuccessListener
        if (info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE || !info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) {
          consent = null; promise.resolve(false); return@addOnSuccessListener
        }
        try {
          val activity = appContext.throwingActivity
          check((activity as? LifecycleOwner)?.lifecycle?.currentState == Lifecycle.State.RESUMED)
          val started = updateManager().startUpdateFlowForResult(info, activity,
            AppUpdateOptions.newBuilder(AppUpdateType.FLEXIBLE).build(), UPDATE_REQUEST)
          if (!started) { consent = null; promise.resolve(false) }
        } catch (error: Exception) {
          consent = null; promise.reject("UPDATE_START_FAILED", error.message, error)
        }
      }.addOnFailureListener {
        if (consent === promise) { consent = null; promise.reject("UPDATE_START_FAILED", it.message, it) }
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, result ->
      if (result.requestCode == UPDATE_REQUEST) {
        val pending = consent
        consent = null
        when (result.resultCode) {
          Activity.RESULT_OK -> pending?.resolve(true)
          Activity.RESULT_CANCELED -> pending?.resolve(false)
          else -> pending?.reject("UPDATE_START_FAILED", "Google Play could not start the update.", null)
        }
      }
    }

    AsyncFunction("completeUpdate") { promise: Promise ->
      try {
        check(supported() && downloaded && consent == null)
        check((appContext.throwingActivity as? LifecycleOwner)?.lifecycle?.currentState == Lifecycle.State.RESUMED)
        updateManager().completeUpdate().addOnSuccessListener { promise.resolve() }
          .addOnFailureListener { promise.reject("UPDATE_INSTALL_FAILED", it.message, it) }
      } catch (error: Exception) { promise.reject("UPDATE_INSTALL_FAILED", error.message, error) }
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      destroyed = true
      manager?.unregisterListener(listener)
      consent?.reject("UPDATE_CLOSED", "The update activity was closed.", null)
      consent = null
    }
  }
}
