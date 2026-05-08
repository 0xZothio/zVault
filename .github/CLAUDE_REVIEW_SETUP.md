# Claude PR Review — One-Time Setup

This repo uses [`anthropics/claude-code-action@v1`](https://github.com/anthropics/claude-code-action)
to auto-review PRs and respond to `@claude` mentions. Two workflows live in
`.github/workflows/`:

- [`claude-code-review.yml`](workflows/claude-code-review.yml) — runs
  automatically on every non-draft PR (`opened`, `synchronize`, `reopened`).
- [`claude.yml`](workflows/claude.yml) — runs only when someone comments
  `@claude ...` on a PR, PR review, or issue.

`CLAUDE.md` at the repo root tells Claude the project context (architecture,
roles, upgrade flow, what to flag).

## 1. Add the Anthropic API key as a repo secret

This is the only secret these workflows need.

1. Go to **Repo → Settings → Secrets and variables → Actions → New repository secret**.
2. **Name**: `ANTHROPIC_API_KEY`
3. **Value**: your Anthropic API key (from <https://console.anthropic.com/settings/keys>).
4. Save.

Both workflows read this secret as `${{ secrets.ANTHROPIC_API_KEY }}`.

## 2. Protect the secret from forks (recommended)

Fork PRs from outside collaborators run untrusted code, which could exfiltrate
secrets. Lock this down:

1. **Repo → Settings → Actions → General**.
2. Under **Fork pull request workflows from outside collaborators**, choose
   **Require approval for all outside collaborators** (or stricter).
3. Save.

Internal collaborator PRs and PRs from branches in this repo will still
auto-review without approval.

## 3. Merge the workflows to the default branch

GitHub only fires `pull_request` workflows from files that already exist on
the **base** branch of the PR. Merge `.github/workflows/claude-code-review.yml`
and `.github/workflows/claude.yml` into your default branch (`main`) before
expecting reviews on incoming PRs.

## 4. Verify it works

1. Open a small test PR against the default branch.
2. The **Claude PR Review** workflow should appear under **Checks** within
   ~30 seconds.
3. When it finishes, Claude posts a single review comment on the PR with
   `Verdict / Critical issues / Suggestions / Nits`.
4. In a comment on that PR, write `@claude please double-check the oracle
   staleness logic in PriceOracle.sol`. The **Claude On-Demand (@claude)**
   workflow should run and reply in the thread.

## Cost / noise controls already in place

- `concurrency.cancel-in-progress: true` on the auto-review workflow — pushing
  5 commits in quick succession results in 1 review, not 5.
- Draft PRs and `dependabot[bot]` PRs are skipped.
- The action posts a **single sticky review comment** that updates in place
  on each new commit instead of spamming new comments.

## Tweaking later

- **Skip docs-only PRs**: add a `paths-ignore: ['docs/**', '**/*.md']` filter
  to the `pull_request` trigger in `claude-code-review.yml`.
- **Pin the action**: replace `@v1` with a commit SHA for supply-chain
  hardening.
- **Switch model**: change `--model claude-sonnet-4-5` in `claude_args` (e.g.
  to a cheaper model for general PRs and keep Sonnet for `.sol`-only PRs by
  splitting the workflow).
- **Use Bedrock / Vertex instead of the Anthropic API**: see the action's
  README for `bedrock` / `vertex` inputs; you'd swap `anthropic_api_key`
  for the corresponding cloud auth.
