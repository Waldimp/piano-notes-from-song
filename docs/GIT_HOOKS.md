# Git hooks (repo-local)

## Co-authored-by: Cursor

Cursor Agent sometimes appends this trailer automatically when it creates
commits (not via a global git config, and not via `~/.cursor/hooks.json` —
that file is empty / unrelated).

This repo uses:

```text
.git/config → core.hooksPath = .githooks
.githooks/prepare-commit-msg  → strips Cursor co-author trailers
```

After clone, enable once (local only, not global):

```bash
git config core.hooksPath .githooks
```

Does **not** rewrite history and does **not** force-push. Existing commits that
already contain the trailer are left as-is.
