#!/usr/bin/env bash
# Usage: ship.sh <branch-name> "<commit message>" [path ...]
# Branch from main, commit, push, open a PR, wait for CI, squash-merge, clean up.
# With no paths, everything is staged (git add -A). With paths, only those are.
set -euo pipefail

branch="${1:-}"
msg="${2:-}"
if [[ -z "$branch" || -z "$msg" ]]; then
  echo 'usage: ship.sh <branch-name> "<commit message>" [path ...]' >&2
  exit 1
fi
shift 2
paths=("$@")   # may be empty

command -v gh >/dev/null || { echo "GitHub CLI (gh) not found" >&2; exit 1; }

# Must start from main, with something to ship
current="$(git branch --show-current)"
if [[ "$current" != "main" ]]; then
  echo "Start from main (you are on '$current')." >&2
  exit 1
fi

if [[ ${#paths[@]} -gt 0 ]]; then
  # Only the given paths are shipped; anything else stays uncommitted
  if [[ -z "$(git status --porcelain -- "${paths[@]}")" ]]; then
    echo "No changes in: ${paths[*]}" >&2
    exit 1
  fi
  echo "About to ship ONLY these paths as '$branch':"
  git status --short -- "${paths[@]}"
  others="$(git status --short | grep -v -F -f <(git status --short -- "${paths[@]}") || true)"
  if [[ -n "$others" ]]; then
    echo; echo "Left out (stays uncommitted):"; echo "$others"
  fi
else
  if [[ -z "$(git status --porcelain)" ]]; then
    echo "Nothing to ship: working tree is clean." >&2
    exit 1
  fi
  echo "About to ship ALL of these as '$branch':"
  git status --short
fi
read -rp "Continue? [y/N] " ok
[[ "$ok" == [yY] ]] || { echo "Aborted."; exit 1; }

# Fast local checks so you don't wait for CI to tell you about typos.
# Skip with: SKIP_CHECKS=1 git ship ...
if [[ "${SKIP_CHECKS:-0}" != "1" ]]; then
  npm run lint && npm run typecheck && npm test
fi

git pull --ff-only --autostash
git switch -c "$branch"

if [[ ${#paths[@]} -gt 0 ]]; then
  git reset -q                 # drop anything staged earlier, so only the chosen paths go in
  git add -- "${paths[@]}"
else
  git add -A
fi
git commit -m "$msg"
git push -u origin "$branch"

gh pr create --base main --fill
# Merge by itself once required checks pass; GitHub deletes the remote branch
gh pr merge "$branch" --squash --auto --delete-branch

echo "Waiting for checks and merge..."
for _ in $(seq 1 180); do   # ~15 minutes
  state="$(gh pr view "$branch" --json state -q .state)"
  [[ "$state" == "MERGED" ]] && break
  if [[ "$state" == "CLOSED" ]]; then
    echo "PR was closed without merging." >&2; exit 1
  fi
  if gh pr checks "$branch" --json bucket -q '.[].bucket' 2>/dev/null | grep -qx fail; then
    echo "A check failed. PR left open, you are still on '$branch':" >&2
    gh pr view "$branch" --json url -q .url >&2
    exit 1
  fi
  sleep 5
done
[[ "$state" == "MERGED" ]] || { echo "Timed out waiting for merge." >&2; exit 1; }

# Back to a clean, up-to-date main
git switch main
git pull --ff-only --autostash
git branch -D "$branch"    # -D because squash merges look "unmerged" to git
git fetch --prune --quiet
echo "Done: '$branch' merged and cleaned up."