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
| Validation | Local static, fake-server, all 94 web E2E tests, and the FOSS preparation check passed. Updated fdroiddata schema, lint, checkupdates, rewritemeta, source and APK checks must pass at the new branch head. |
| Reports | Fastlane's source report includes informational metadata-discovery entries. The updated pipeline report has one INFO entry confirming summary, description, changelog, icon and five screenshots; no warnings or errors. |
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
