# Changesets

This folder is managed by [`@changesets/cli`](https://github.com/changesets/changesets) — the tool that versions and publishes the `@onda-engine/*` packages.

To record a change for the next release:

```bash
pnpm changeset
```

Pick the affected packages and the bump type (patch/minor/major) and describe the change. The generated markdown file is committed alongside your PR; it's consumed (and deleted) when versions are applied with `pnpm changeset:version`.

See [PUBLISHING.md](../PUBLISHING.md) for the full release flow and prerequisites. **Nothing here publishes automatically** — publishing is an explicit, manual step.
