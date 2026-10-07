# F-Droid submission review

Reviewed on 2026-10-07. [Source fixes](https://github.com/alvarolorentedev/opencode-mobile/tree/codex/fdroid-checklist) · [F-Droid pipeline](https://gitlab.com/alvarolorentedev/fdroiddata/-/pipelines/2922519005). Intended MR title: **New app: OpenCode Mobile**.
The fdroiddata branch must contain only `metadata/app.getopencode.fdroid.yml`.

| Checklist area | Evidence / status |
| --- | --- |
| Inclusion policy | Apache-2.0 upstream app; FOSS build excludes Play Billing, ML Kit, proprietary Firebase Messaging and install-referrer. Free replacement classes retain their original package names. Final acceptance belongs to F-Droid reviewers. |
| Author notification | Submission is by the upstream author, Alvaro Lorente (`alvarolorentedev`); no third-party author reply is needed for an author submission. |
| Store metadata | Upstream `fastlane/metadata/android/en-US/` has title, summary, description, changelog 52, icon and five phone screenshots. The recipe pins public source commit `029ea4aef4c69e56b8b8cd315fa9bba44592580d`, which contains them. |
| Documentation | Reviewed the inclusion policy, CONTRIBUTING.md, general and React Native templates, build metadata reference, Quick Start, reproducible-build and Git guides. Links below. |
| Fork and branch | GitLab fork `alvarolorentedev/fdroiddata` is public; `app.getopencode.fdroid` is not protected. |
| MR setup | No MR currently exists for this branch in the fork or `fdroid/fdroiddata`. Use the title above and submit a single app after the updated pipeline passes. Rebase only if there is a conflict. |
| Related issues | Searches for `opencode` in `fdroid/rfp` and `fdroid/fdroiddata` found no related issue; the one fdroiddata result is unrelated. |
| File and syntax | Correct application ID and metadata path; YAML uses LF; one enabled build; full source SHA; no localized text or artwork is added to fdroiddata. |
| Release updates | Latest release is v1.0.52 (version code 52); tags and `AutoUpdateMode: Version` with tag filtering are configured. Source fixes after the tag require a new full commit pin. |
| Contact | AuthorName, AuthorEmail, author website and upstream issue tracker are included. |
| External repositories | Firebase stubs are pinned at `ce90a956aacda17a85c60577ee443aeb83d876ef` as `vendor/firebase-stubs`; F-Droid initializes and scans submodules. No srclib is needed. |
| Reproducibility | Exception documented: upstream v1.0.52 uses JDK 17 / Expo prebuilts; F-Droid uses JDK 21 / Expo source builds. APK equivalence has not been established. The upstream signing-key restriction is omitted while Binaries is absent. Resolve shared signing before first publication if required. |
| ABI split | FOSS APK already includes only arm64-v8a (upstream v1.0.52 asset is about 49 MB). Splitting additional ABIs cannot shrink this single-ABI native payload. |
| Anti-features | Optional speech input uses the installed system recognizer and can retry using its network service. This behavior is disclosed; reviewers may require NonFreeNet. Self-hosted OpenCode remains usable without voice. |
| Validation | Local static, fake-server, all 94 web E2E tests, and the FOSS preparation check passed. All nine jobs in pipeline `2922519005` passed at squashed fdroiddata commit `71de30c2eb1f21afc4a2f2428a6dc25a1422addc`, including the build and APK checks. |
| Reports | Fastlane's source report includes informational metadata-discovery entries. Final report: 37 entries (1 MAJOR, 5 MINOR, 31 INFO). The six flagged settings/permissions are explained below; metadata, ABI/size, artifact and other permission entries are informational. |
| CI billing | If GitLab blocks CI pending phone/card details, leave the pipeline pending and ask maintainers to trigger it in the MR. |

The icon and screenshots were retrieved from the author's
[Google Play listing](https://play.google.com/store/apps/details?id=app.getopencode).
They show shared self-hosted app features; the F-Droid description explains that
Cloud Link subscriptions, QR pairing and Firebase push messaging are absent.

## Reproducibility explanation for the MR

Reproducible builds are not enabled for this submission. The published v1.0.52
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

The 31 INFO entries describe the five screenshots/icon/text/changelog discovery,
the built APK, its ARM64 ABI and 47 MB size, R8 configuration and remaining
permissions. Notification/badge permissions come from expo-notifications,
biometric permissions from expo-secure-store, and WRITE_SETTINGS supports the
user-authorized conversation screen-dimming feature. These are disclosures,
not failing checks.

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
