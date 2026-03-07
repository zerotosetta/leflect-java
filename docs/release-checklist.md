# Release Checklist

## Pre-release

- Confirm `pnpm install` completes on a clean clone
- Run `pnpm release:check`
- Verify `node bin/leflect --help` works after `pnpm build`
- Verify `node packages/cli/dist/index.js analyze --root tests/fixtures/custom-tag --out <tmp> --incremental`
- Verify `node packages/cli/dist/index.js query tag-usages --analysis <tmp> --class FormTag`

## Package Metadata

- Root workspace name remains `@lefectjava/workspace`
- CLI package name remains `@lefectjava/cli`
- CLI package exports `bin` as `leflect -> dist/index.js`
- `bin/leflect` remains available for workspace usage

## CI Expectations

- TypeScript build passes
- Unit tests pass
- Integration/E2E tests pass

## Follow-up

- Tag the release in Git after merge
- Publish the CLI package when registry credentials and release policy are ready
