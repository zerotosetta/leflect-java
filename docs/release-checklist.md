# Release Checklist

## Pre-release

- Confirm `pnpm install` completes on a clean clone
- Run `pnpm release:check`
- Run `pnpm release:prepare`
- Run `pnpm release:prepare:next` when preparing prerelease/dist-tag promotion
- Verify `node bin/leflect --help` works after `pnpm build`
- Verify `node packages/cli/dist/index.js analyze --root tests/fixtures/custom-tag --out <tmp> --incremental`
- Verify `node packages/cli/dist/index.js query tag-usages --analysis <tmp> --class FormTag`
- Run `pnpm binary:build`
- Run `pnpm binary:test`
- Run `pnpm binary:build:all`
- Run `pnpm binary:test:all`

## Package Metadata

- Root workspace name remains `@leflect-java/workspace`
- CLI package name remains `@leflect-java/cli`
- Workspace libraries publish under `@leflect-java/*`
- CLI package exports `bin` as `leflect -> dist/index.js`
- CLI release staging bundles `java/worker-jar.json` and `java/leflectjava-java-worker-*.jar`
- Standalone binary package name is `@leflect-java/cli-binary-<platform>-<arch>`
- Default binary target matrix is `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`
- `release:publish:next` should assign `next` via `npm dist-tag add` when the version already exists
- `bin/leflect` remains available for workspace usage

## CI Expectations

- TypeScript build passes
- Unit tests pass
- Integration/E2E tests pass

## Follow-up

- Tag the release in Git after merge
- Publish staged packages with `pnpm release:publish`
- Promote or prerelease with `pnpm release:publish:next`
