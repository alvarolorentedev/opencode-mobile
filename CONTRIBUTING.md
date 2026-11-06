# Contributing

Contributions are welcome. Please use the issue forms for bug reports and
feature requests, and search existing issues before opening a new one. For
security concerns, follow [SECURITY.md](SECURITY.md). For conduct concerns, see
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Development setup

Install the requirements and follow the setup steps in the
[development guide](docs/engineering/development.md). The supported Node.js
range is defined by `package.json` and `.nvmrc`.

## Changes and pull requests

- Keep changes focused and follow the ownership and layering rules in
  [feature boundaries](docs/architecture/feature-boundaries.md).
- Before committing, run `npm run validate:commit` and the relevant focused
  checks from the [validation strategy](docs/engineering/validation/strategy.md).
- Open a pull request with a clear summary, verification results, and any known
  risks. The repository's pull request template includes the project checklist.
- Do not include credentials, access tokens, or private user data in commits,
  issues, screenshots, or logs.
