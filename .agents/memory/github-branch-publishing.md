---
name: GitHub branch publishing
description: Safe fallback when a workspace Git remote cannot authenticate but the GitHub connector is active.
---

When a direct `git push` fails authentication while the Replit GitHub connector is active, publish source changes through GitHub's Git Data API instead of requesting a token or force-pushing.

**Why:** Connector OAuth is available through the managed API proxy but is not necessarily wired into the repository's Git remote transport.

**How to apply:** Verify the target ref still points to the expected parent, create blobs/tree/commit from the intended files, then update only that ref with `force: false`. Confirm the remote tree matches the local committed tree and report any differing local/remote commit IDs transparently.