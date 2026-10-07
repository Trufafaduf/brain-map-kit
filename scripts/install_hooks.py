#!/usr/bin/env python3
"""Install the identifying-info check as this repo's pre-commit hook.

    python scripts/install_hooks.py

Also creates an empty `.identifying-denylist.txt` (gitignored) for your own
private terms if you don't have one yet: your name, usernames, email, the
names of people and places you don't want published.
"""
import os, stat, subprocess

root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
hooks = subprocess.run(["git", "rev-parse", "--git-path", "hooks"], capture_output=True, text=True, check=True, cwd=root).stdout.strip()
hooks = hooks if os.path.isabs(hooks) else os.path.join(root, hooks)
os.makedirs(hooks, exist_ok=True)
hook = os.path.join(hooks, "pre-commit")
with open(hook, "w", newline="\n") as f:
    f.write("#!/bin/sh\n"
            "# Installed by scripts/install_hooks.py: block commits containing identifying information.\n"
            "top=$(git rev-parse --show-toplevel)\n"
            "# Use the first Python that actually runs: on Windows python3 can be a Store stub.\n"
            "for PY in python3 python py; do\n"
            "  command -v \"$PY\" >/dev/null 2>&1 && \"$PY\" -c '' >/dev/null 2>&1 && break\n"
            "  PY=\n"
            "done\n"
            "[ -n \"$PY\" ] || { echo \"pre-commit: no working Python, so the identifying-info check can't run\" >&2; exit 1; }\n"
            "exec \"$PY\" \"$top/scripts/check_identifying.py\"\n")
os.chmod(hook, os.stat(hook).st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
print("installed", hook)

deny = os.path.join(root, ".identifying-denylist.txt")
if not os.path.exists(deny):
    with open(deny, "w", encoding="utf-8") as f:
        f.write("# Private terms that must never be committed, one per line (case-insensitive).\n"
                "# This file is gitignored. /slashes/ make a line a regular expression.\n")
    print("created", deny, "- add your own terms to it")
