# F-Droid submission review

Reviewed on 2026-10-08. [Release source](https://github.com/alvarolorentedev/opencode-mobile/tree/7ad8a78d6c188f1f2e2550a38111f15283658580) · [F-Droid pipeline](https://gitlab.com/alvarolorentedev/fdroiddata/-/pipelines/2925072410). MR title: **New app: OpenCode Mobile**.
The fdroiddata branch must contain only `metadata/app.getopencode.fdroid.yml`.

| Checklist area | Evidence / status |
| --- | --- |
| Inclusion policy | Apache-2.0 upstream app; FOSS build excludes Play Billing, ML Kit, proprietary Firebase Messaging and install-referrer. Free replacement classes retain their original package names. Final acceptance belongs to F-Droid reviewers. |
| Author notification | Submission is by the upstream author, Alvaro Lorente (`alvarolorentedev`); no third-party author reply is needed for an author submission. |
| Store metadata | Upstream `fastlane/metadata/android/en-US/` has title, summary, description, changelog 55, icon and five phone screenshots. The recipe pins public release commit `7ad8a78d6c188f1f2e2550a38111f15283658580`, which contains them. |
| Documentation | Reviewed the inclusion policy, CONTRIBUTING.md, general and React Native templates, build metadata reference, Quick Start, reproducible-build and Git guides. Links below. |
| Fork and branch | GitLab fork `alvarolorentedev/fdroiddata` is public; `app.getopencode.fdroid` is not protected. |
| MR setup | [MR !51559](https://gitlab.com/fdroid/fdroiddata/-/merge_requests/51559) exists with the correct title and one app. Include the reproducibility exception and APK-report explanations below in its description. Rebase only if there is a conflict. |
| Related issues | Searches for `opencode` in `fdroid/rfp` and `fdroid/fdroiddata` found no related issue; the one fdroiddata result is unrelated. |
| File and syntax | Correct application ID and metadata path; YAML uses LF; one enabled build; full source SHA; no localized text or artwork is added to fdroiddata. |
| Release updates | Latest release is v1.0.55 (version code 55); tags and `AutoUpdateMode: Version` with tag filtering are configured. The recipe pins the full release commit. |
| Contact | AuthorName, AuthorEmail, author website and upstream issue tracker are included. |
| External repositories | Following the maintainer-requested React Native template, F-Droid uses `firebase-stub@ce90a956aacda17a85c60577ee443aeb83d876ef` as a srclib. Upstream FOSS builds download the same pinned sources temporarily; the submodule is removed. |
| Reproducibility | Exception documented: upstream uses JDK 17 / Expo prebuilts; F-Droid uses JDK 21 / Expo source builds. APK equivalence has not been established. The upstream signing-key restriction is omitted while Binaries is absent. Resolve shared signing before first publication if required. |
| ABI split | FOSS APK includes only arm64-v8a. Splitting additional ABIs cannot shrink this single-ABI native payload. |
| Anti-features | Optional speech input uses the installed system recognizer and can retry using its network service. This behavior is disclosed; reviewers may require NonFreeNet. Self-hosted OpenCode remains usable without voice. |
| Validation | All nine jobs passed in MR pipeline `2925072410` at fork commit `3da2d77cf9a2d6b1615fc85755d01e33dd12e317`, including the srclib build and APK scan. Local static, fake-server, all 94 web E2E tests, and the FOSS preparation check passed. The FOSS build's pinned source download, Expo prebuild, temporary-checkout cleanup and package.json restoration were verified; a signed upstream APK was not built locally. |
| Reports | Fastlane's source report includes informational metadata-discovery entries. Android settings and permission findings are explained below; metadata, ABI, artifact and other permission entries are informational. Passing CI does not replace reviewer assessment of these disclosures. |
| CI billing | If GitLab blocks CI pending phone/card details, leave the pipeline pending and ask maintainers to trigger it in the MR. |

The icon and screenshots were retrieved from the author's
[Google Play listing](https://play.google.com/store/apps/details?id=app.getopencode).
They show shared self-hosted app features; the F-Droid description explains that
Cloud Link subscriptions, QR pairing and Firebase push messaging are absent.

## Reproducibility explanation for the MR

Reproducible builds are not enabled for this submission. The published v1.0.55
upstream APK was built with JDK 17 and Expo prebuilts, while the F-Droid recipe
uses JDK 21 and compiles Expo modules from source. A byte-identical unsigned APK
has not been verified. This is why Binaries and upstream signatures are absent.
F-Droid would sign this package with its own key, preventing seamless upgrades
between GitHub and F-Droid APKs. Shared signing must be resolved before first
publication if that capability is required.

## APK report explanations for the MR

The final pipeline passes. Its Reports tab still lists Android settings and
permissions for reviewer inspection:

| Report finding | Explanation |
| --- | --- |
| Cleartext Traffic Permitted (MAJOR) | Intentional: users can connect to their own OpenCode server over HTTP, including LAN/VPN deployments. `app.config.ts` explicitly enables this. Use HTTPS across untrusted networks. |
| INTERNET (MINOR) | Required for the user-configured OpenCode API and SSE connection. |
| RECORD_AUDIO (MINOR) | Optional voice input; `lib/voice/permissions.ts` requests microphone consent at runtime. Typed chat works without granting it. |
| READ_EXTERNAL_STORAGE / WRITE_EXTERNAL_STORAGE (2 MINOR) | Inherited from the Expo Android template, expo-file-system and expo-image. The source manifests cap these legacy declarations at Android SDK 32. App attachments use the system document picker with a copy in app cache; the app does not request broad storage permission at runtime. |
| SYSTEM_ALERT_WINDOW (MINOR) | Inherited from Expo's generated base manifest. The app does not request overlay access or draw overlays; this declaration grants no special overlay access without the user enabling it. It is retained in the currently verified APK. |

Informational entries describe the five screenshots/icon/text/changelog discovery,
the built APK, its ARM64 ABI, R8 configuration and remaining
permissions. Notification/badge permissions come from expo-notifications and
biometric permissions from expo-secure-store. These are disclosures, not
failing checks.

Dependency compiler deprecations and the CI cache messages (`.gradle` missing /
no files to cache) are outside the Reports tab. They do not prevent the successful
build or APK scan; the cache messages come from the shared fdroiddata CI setup.

## References

- [Inclusion policy](https://f-droid.org/docs/Inclusion_Policy/)
- [Contribution guide](https://gitlab.com/fdroid/fdroiddata/-/blob/master/CONTRIBUTING.md)
- [Templates](https://gitlab.com/fdroid/fdroiddata/-/tree/master/templates)
- [Build metadata reference](https://f-droid.org/docs/Build_Metadata_Reference/)
- [Quick Start](https://f-droid.org/en/docs/Submitting_to_F-Droid_Quick_Start_Guide/)
- [Fastlane structure](https://gitlab.com/snippets/1895688)
- [Triple-T structure](https://gitlab.com/snippets/1901490)
- [Reproducible builds](https://f-droid.org/docs/Reproducible_Builds/)
- [Git guide](https://gitlab.com/fdroid/wiki/-/wikis/Tips-for-fdroiddata-contributors/Git-Usage)
- [Protected branches](https://docs.gitlab.com/user/project/repository/branches/protected/)
