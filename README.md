# Muse Auto-Allow — Chrome extension (Manifest V3)

Auto-clicks **Allow / Accept** on Muse approval cards — but only for a narrow,
user-editable allow-list, and only on origins you explicitly enable. Safe by default.

## What it does

A content script watches the page with a `MutationObserver`. When a button labelled
Allow / Accept / Approve (or "Cho phép" / "Đồng ý") appears, the extension reads
the surrounding card text and classifies it:

1. **Hard deny-list first (always wins):** merge PR, payment/billing, credentials /
   secrets / passwords / tokens, delete / destructive, install / run unknown
   binaries, `sudo`, `rm -rf`. These are **never** auto-allowed.
2. **Allow-list:** git branch creation, git push, git commit, opening a pull
   request, reading files — scoped to repos under `tuanxminhxgi/`.
3. **No match → ignore:** the card is left alone, untouched.

If classified `allow`, the extension waits **800 ms**, re-checks the card is still
in the DOM and still classifies as `allow`, and only then clicks the button.
Every decision (allow / deny / ignore) is logged to `chrome.storage.local`
(capped at 200 entries) and visible in the popup.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder
   (`~/workspace/muse-auto-allow-extension/`).
4. The extension icon appears in the toolbar.

## Enable it for the Muse chat origin

1. Open the Muse chat tab.
2. Click the **Muse Auto-Allow** icon in the toolbar.
3. Turn on **"Allow on this site"**.

The per-origin gate is **OFF by default for every site** — the extension stays
completely inert until you enable it for that origin. The master toggle must also
be on (it is ON after install; turn it off to kill-switch everything).

## How the allow-list works

The popup shows the allow-list as one regex per line. Edit it and click
**Save allow-list** — invalid regexes are rejected with an error and not saved.
The deny-list is shown read-only and cannot be edited from the popup; it is
hard-coded in `rules.js` (`DEFAULT_DENY_LIST`) and always checked first.

Default allow rules: `git branch`, `git push`, `git commit`, `create/open a pull
request`, `pull request`, `read(ing) files`, `tuanxminhxgi/`.

## Safety notes

- **Never auto-allows** merges, payments, credentials, or destructive actions —
  the deny-list is checked first and always wins.
- **Server-side execution-risk flags cannot be auto-clicked by any extension.**
  Those are not DOM approval cards; only Martin's direct confirmation opens
  them. If a Muse stops on such a flag, this extension cannot help — Martin
  must confirm in his own words.
- **DOM selectors may break if the Muse UI changes.** The detector looks for
  buttons labelled Allow/Accept/Approve and reads the surrounding card text;
  a UI redesign can make it miss cards (fail-safe: it does nothing) or, in
  principle, misread a card. Check the log in the popup after first use.
- The 800 ms delay + re-check means a card that disappears or changes meaning
  before the click is never clicked.
- No remote code, no network calls, no data leaves the browser. All state lives
  in `chrome.storage` (settings in `sync`, log in `local`).

## Turn it off

- Popup → turn off **Master enabled** (instant kill switch), or turn off
  **Paused**, or turn off **"Allow on this site"** for that origin.
- Or remove the extension entirely at `chrome://extensions`.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest: content script on `https://*/*`, `storage` permission only |
| `rules.js` | Pure classification logic (`classifyAction`, allow/deny lists) — no chrome APIs, unit-testable |
| `content.js` | MutationObserver card detection, 800 ms safety delay + re-check, logging |
| `background.js` | Service worker: seeds default settings on install |
| `popup.html` / `popup.js` | Master + per-origin toggles, allow-list editor, deny-list display, log viewer, Clear / Export log |
| `test/rules.test.mjs` | Node unit tests for `rules.js` |

## Tests

```sh
node --check rules.js content.js background.js popup.js
node test/rules.test.mjs
```

All 11 assertions pass (see test file for the cases: git push/branch/PR/read
allowed; merge PR / payment / credential / delete denied; unrelated and empty
text ignored; deny wins when both lists match).
