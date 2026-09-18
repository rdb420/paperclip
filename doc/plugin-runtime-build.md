# Plugin Runtime Build Contract

Paperclip keeps pnpm as the reproducible package-manager baseline for repository
builds and self-hosted deployments. The server uses pnpm for workspace plugins.

Standalone bundled providers are the exception because they are intentionally
excluded from the root workspace. Their install path is selected by
`PAPERCLIP_PLUGIN_PACKAGE_MANAGER`:

- Unset or any value other than `bun`: use pnpm with `--ignore-workspace`.
- `bun`: use the pinned Bun runtime in the cloud image with `bun install
  --no-save --ignore-scripts` and `bun run build`.

The Bun switch applies only to standalone bundled-provider bootstrap. Workspace
plugins always use the root pnpm installation and `pnpm --filter ... build`.
This preserves the pnpm path as the local and self-hosted rollback baseline.

## Image Targets

- `production` is the self-hosted image. Its default build target remains
  production and does not require Bun.
- `cloud` is the managed image. It builds the Cloudflare sandbox provider and
  includes Bun `1.2.21` for standalone provider installation at runtime.

The cloud workflow sets `CLOUD_BUNDLED_PLUGINS=cloudflare`. The provider must
also remain listed in `BUNDLED_PLUGIN_CATALOG` so the managed auto-installer can
resolve the bundled path.

## Verification

Run the focused server checks from the repository root:

```sh
pnpm exec vitest run \
  server/src/__tests__/plugin-install-autobuild.test.ts \
  server/src/__tests__/bundled-plugins.test.ts \
  server/src/__tests__/cloud-image-bundled-plugins.test.ts \
  --config vitest.config.ts
pnpm exec tsc --noEmit -p server/tsconfig.json
```

Build each standalone provider from its package root with pnpm before enabling
the cloud image path:

```sh
cd packages/plugins/sandbox-providers/cloudflare
pnpm install --ignore-workspace --prod=false --no-lockfile
pnpm build
pnpm test
pnpm typecheck
```

To exercise the Bun command selection in an image or a compatible host, set
`PAPERCLIP_PLUGIN_PACKAGE_MANAGER=bun` and install Bun `1.2.21` or a compatible
version. Do not use this setting for the root workspace build.

## Cloudflare Smoke Test

Deploy `packages/plugins/sandbox-providers/cloudflare/bridge-template` with its
`Sandbox` Durable Object binding. Bind the bridge token through a company secret
reference. Configure the Paperclip environment with the HTTPS bridge URL and
the secret reference, then acquire and release one ephemeral lease. Record the
probe result without recording the token.
