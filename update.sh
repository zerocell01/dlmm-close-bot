#!/usr/bin/env bash
# update.sh — one-command commit + push for dlmm-close-bot
#
# Usage:
#   ./update.sh                      -> auto-generated commit message with timestamp
#   ./update.sh "your message here"  -> custom commit message
#
# Works in Git Bash (MINGW64) on Windows, and in plain bash on Linux/Mac.

set -e

# Always run from the folder this script lives in, regardless of where
# it's called from — avoids "not a git repository" errors.
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "== dlmm-close-bot update =="
echo "Folder: $(pwd)"
echo ""

# Make sure we're actually inside the git repo.
if [ ! -d .git ]; then
  echo "ERROR: no .git folder here. Are you in the right directory?"
  exit 1
fi

# Never accidentally commit secrets or local state.
if [ -f .env ]; then
  if git check-ignore -q .env; then
    : # correctly ignored, fine
  else
    echo "WARNING: .env exists and is NOT in .gitignore — refusing to continue."
    echo "Fix .gitignore before pushing, so your private key never ends up on GitHub."
    exit 1
  fi
fi

git add -A

if git diff --cached --quiet; then
  echo "Nothing changed — working tree already matches the last commit."
  exit 0
fi

echo "Changed files:"
git diff --cached --name-status
echo ""

# Commit message: use the argument if given, otherwise a timestamped default.
if [ -n "$1" ]; then
  MSG="$1"
else
  MSG="Update $(date '+%Y-%m-%d %H:%M:%S')"
fi

git commit -m "$MSG"
echo ""
echo "Pushing to origin..."
git push

echo ""
echo "Done. Latest commit:"
git log -1 --oneline
