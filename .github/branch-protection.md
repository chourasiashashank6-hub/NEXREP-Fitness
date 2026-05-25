# Branch protection (intended rules)

Configure these in **GitHub → Repository → Settings → Branches → Branch protection rules** for `main`.

## `main` branch

| Rule | Setting |
|------|---------|
| Require a pull request before merging | **Enabled** |
| Required approvals | **1** |
| Dismiss stale pull request approvals when new commits are pushed | Recommended |
| Require status checks to pass before merging | **Enabled** (when CI workflow exists) |
| Require branches to be up to date before merging | Recommended |
| Restrict who can push to matching branches | **Enabled** (no direct pushes to `main`) |
| Allow force pushes | **Disabled** |
| Allow deletions | **Disabled** |

## Workflow

1. Branch from `main`: `git checkout -b feature/short-description`
2. Open a pull request into `main`
3. Wait for CI (lint/build) and at least one approval from a code owner
4. Merge via squash or merge commit (team preference)

## `develop` (optional)

If you add a `develop` integration branch, use the same PR requirement with optional relaxed approval count for experiments.

## Secrets

Never commit `.env` files. Use GitHub **Settings → Secrets and variables → Actions** for CI and your host’s environment UI for production.
