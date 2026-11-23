# Muse Auto-Allow — Chrome extension (Manifest V3)

Auto-clicks **Allow / Accept** on Muse approval cards — but only for a narrow,
user-editable allow-list, and only on origins you explicitly enable. Safe by default.

## What it does

A content script watches the page with a `MutationObserver`. It works in two steps:

1. **Review (v1.1.0):** a pending task first shows an "A task needs review"
   banner with a **Review** link/button. Clicking Review only *opens* the
   approval panel — it approves nothing. The extension clicks Review (after
   the 800 ms safety delay + re-check, one at a time, with a 2 s cooldown
   between Review clicks) so the panel and its real action text become visible.
   If the Allow button is already visible, this step is skipped.
2. **Allow / Approve:** once the panel is open, the extension reads the
   surrounding card text and classifies it:

   - **Hard deny-list first (always wins):** merge PR, payment/billing, credentials /
     secrets / passwords / tokens, delete / destructive, install / run unknown
     binaries, `sudo`, `rm -rf`. These are **never** auto-allowed.
   - **Allow-list:** git branch creation, git push, git commit, opening a pull
     request, reading files, read-only GitHub actions (`Get file contents`,
     `Get commit` — the scheduled "Mailbox Check" cards) — scoped to repos
     under `tuanxminhxgi/`. v1.1.3 adds the GitHub phrases from Martin's
     screenshots: `look up a specific commit`, `push(ing) files`, `push a new …`,
     `change content`, and the card header `on your GitHub account`.
     The deny-list is unchanged and still checked first.
   - **No match → ignore:** the card is left alone, untouched. Opening its
     panel via Review does not approve it.

If classified `allow`, the extension waits **800 ms**, re-checks the card is still
in the DOM and still classifies as `allow`, and only then clicks Allow / Accept /
Approve (or "Cho phép" / "Đồng ý").
Every decision (review / allow / deny / ignore) is logged to `chrome.storage.local`
(capped at 200 entries) and visible in the popup.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder
   (`~/workspace/muse-auto-allow-extension/`).
4. The extension icon appears in the toolbar.

After updating to a new version: **Reload in `chrome://extensions` alone does
NOT download new code from GitHub.** First update the local folder, then reload:

1. In the folder you loaded unpacked from, run `git pull` (or download the
   latest code from GitHub and replace that folder).
2. Open `chrome://extensions` and click **Reload** on Muse Auto-Allow.
   Check the version shown there is the new one (v1.1.1 or later).
3. Reload the Muse chat tab (F5) — a content script only injects on page load,
   so an already-open tab keeps running the old code until you reload it.
4. Open the extension popup on the Muse tab and check it shows the new
   version and **"Allow on this site"** is ON for muse.ai.

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
request`, `pull request`, `read(ing) files`, `get file contents`,
`retrieve file contents`, `get commit`, `look up commit`, `tuanxminhxgi/`.

## Safety notes

- **Never auto-allows** merges, payments, credentials, or destructive actions —
  the deny-list is checked first and always wins.
- **Server-side execution-risk flags cannot be auto-clicked by any extension.**
  Those are not DOM approval cards; only Martin's direct confirmation opens
  them. If a Muse stops on such a flag, this extension cannot help — Martin
  must confirm in his own words.
- **DOM selectors may break if the Muse UI changes.** The detector looks for
  buttons labelled Review, then Allow/Accept/Approve, and reads the surrounding
  card text; a UI redesign can make it miss cards (fail-safe: it does nothing)
  or, in principle, misread a card. Check the log in the popup after first use.
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
| `rules.js` | Pure classification logic (`classifyAction`, allow/deny lists, Review/Allow button labels) — no chrome APIs, unit-testable |
| `content.js` | MutationObserver card detection, Review → Allow two-step flow, 800 ms safety delay + re-check, logging |
| `background.js` | Service worker: seeds default settings on install |
| `popup.html` / `popup.js` | Master + per-origin toggles, allow-list editor, deny-list display, log viewer, Clear / Export log |
| `test/rules.test.mjs` | Node unit tests for `rules.js` |

## Tests

```sh
node --check rules.js content.js background.js popup.js
node test/rules.test.mjs
```

All 18 assertions pass (see test file for the cases: git push/branch/PR/read
allowed; `Get file contents` / `Get commit` on GitHub allowed; merge PR /
payment / credential / delete denied; unrelated and empty text ignored; deny
wins when both lists match; Review vs Allow button labels distinguished,
including a trailing "Review ›"; rules.js exports are also on globalThis;
`isExtensionActive` is ON in the normal case and OFF when paused).

The Review → Allow end-to-end flow was also verified in a jsdom harness
against the exact `hatch-inline-approval-card` HTML from the Muse UI
(2026-11-23): the Review button is clicked first, the panel opens, then
Allow is clicked — in that order, once each.

## Changelog

- **v1.1.3** — GitHub actions added to the allow-list at Martin's request,
  restrictions kept: `look up a specific commit`, `push(ing) files`,
  `push a new …`, `change content`, and the GitHub card header
  `on your GitHub account`; deny-list unchanged and still checked first.
  Also fixes why the "Get commit" card in his screenshot was not clicked
  even though its Allow button already carried
  `data-muse-auto-allow-processed="1"`: an `ignore` classification (e.g.
  on incomplete panel text) used to mark the button processed forever, so
  it was never retried once the full text rendered. Now only `allow`/`deny`
  mark a button processed; `ignore` stays eligible for a later scan, and
  a failed 800 ms re-check also unmarks the button so it can retry.
- **v1.1.2** — **Root-cause fix:** content.js had `if (!settings.paused)
  return false`, inverting the pause check and leaving the extension
  permanently inert in the normal (not paused) case. Activation logic is
  now the unit-tested `isExtensionActive()` in rules.js. Also removed the
  `allowVisible` block that could deadlock Review when an Allow button was
  already in the DOM, Review now runs before Allow, the observer also
  watches attributes, and a re-scan runs after Review is clicked so a panel
  that only toggles display is still caught. Button + inner span are
  treated as one Review control (clicked once).
- **v1.1.1** — Review detection now also tries plain `<div>`/`<span>` elements
  (some Muse UI builds render Review that way) and accepts a trailing arrow;
  rules.js copies its exports onto `globalThis` so content.js does not depend
  only on lexical sharing across content-script files; the popup shows the
  installed version so a stale install is visible at a glance.

## Changelog

- **v1.1.1** — Review detection now also tries plain `<div>`/`<span>` elements
  (some Muse UI builds render Review that way) and accepts a trailing arrow;
  rules.js copies its exports onto `globalThis` so content.js does not depend
  only on lexical sharing across content-script files; the popup shows the
  installed version so a stale install is visible at a glance.
- **v1.1.0** — Two-step flow: click Review to open the approval panel, then
  click Allow/Approve only for allow-listed actions; read-only GitHub allow
  rules (`get file contents`, `get commit`) added.
