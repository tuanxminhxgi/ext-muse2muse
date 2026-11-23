// content.js — detects Muse approval cards and auto-allows only
// allow-listed ones, on origins the user explicitly enabled.
// Runs inert unless: masterEnabled && !paused && origins[location.origin] === true.
//
// Two-step flow (v1.1.0):
//   1. REVIEW — a pending task first shows an "A task needs review" banner
//      with a Review link/button. Clicking Review only OPENS the approval
//      panel; it approves nothing. The extension clicks it so the panel
//      (and its real action text) becomes visible.
//   2. ALLOW / APPROVE — once the panel is open, the extension reads the
//      card text, classifies it with classifyAction() (deny-list first,
//      always wins), and clicks Allow/Accept/Approve ONLY if classified
//      `allow`, after the 800 ms safety delay + re-check.
// If the panel is already open, step 1 is skipped and step 2 runs directly.
'use strict';

// rules.js is loaded before this file in the same content-script world
// and also copies its exports onto globalThis (see rules.js bottom), so
// read the shared values from globalThis first — lexical sharing of
// top-level consts across content-script files is not something to bet
// the whole extension on. Fall back to the lexical names, then to local
// copies, in that order.
const _g = (typeof globalThis !== 'undefined') ? globalThis : {};
const ALLOW_RE = _g.ALLOW_BUTTON_RE || (typeof ALLOW_BUTTON_RE !== 'undefined' ? ALLOW_BUTTON_RE : /^(allow|accept|approve|cho phép|đồng ý)$/i);
const REVIEW_RE = _g.REVIEW_BUTTON_RE || (typeof REVIEW_BUTTON_RE !== 'undefined' ? REVIEW_BUTTON_RE : /^(review|xem xét|duyệt|xem lại)\s*[›→»>]?$/i);
const CLASSIFY_FN = _g.classifyAction || (typeof classifyAction !== 'undefined' ? classifyAction : null);
const FALLBACK_ALLOW_LIST = _g.DEFAULT_ALLOW_LIST || (typeof DEFAULT_ALLOW_LIST !== 'undefined' ? DEFAULT_ALLOW_LIST : []);
const FALLBACK_DENY_LIST = _g.DEFAULT_DENY_LIST || (typeof DEFAULT_DENY_LIST !== 'undefined' ? DEFAULT_DENY_LIST : []);
const MAX_ACTION_CHARS = 500;
const SAFETY_DELAY_MS = 800;
// After clicking Review, give the panel time to appear before clicking
// another Review button (prevents double-opening / racing a second task).
const REVIEW_CLICK_COOLDOWN_MS = 2000;
const LOG_CAP = 200;
const PROCESSED_ATTR = 'data-muse-auto-allow-processed';
const IGNORE_LOGGED_ATTR = 'data-muse-auto-allow-ignore-logged';
const REVIEW_PROCESSED_ATTR = 'data-muse-auto-allow-review-processed';

// Escape hatch: the popup toggle can set this before the script runs.
if (typeof window !== 'undefined' && window.__museAutoAllowPaused) {
  // Fall through to the observer setup, which re-checks settings anyway.
}

let settings = null; // { masterEnabled, paused, origins, allowList, denyList }
let settingsReady = false;
let lastReviewClickAt = 0;

function loadSettings() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(
        ['masterEnabled', 'paused', 'origins', 'allowList', 'denyList'],
        (r) => {
          settings = {
            masterEnabled: r.masterEnabled !== false,
            paused: r.paused === true,
            origins: r.origins || {},
            allowList: Array.isArray(r.allowList) ? r.allowList : FALLBACK_ALLOW_LIST,
            denyList: Array.isArray(r.denyList) ? r.denyList : FALLBACK_DENY_LIST
          };
          settingsReady = true;
          resolve(settings);
        }
      );
    } catch (e) {
      settings = null;
      settingsReady = false;
      resolve(null);
    }
  });
}

function isActiveForThisOrigin() {
  if (!settingsReady || !settings) return false;
  if (typeof window !== 'undefined' && window.__museAutoAllowPaused) return false;
  // Activation logic lives in rules.js (isExtensionActive) and is unit
  // tested — do NOT re-implement the paused/master checks here.
  const fn = _g.isExtensionActive || (typeof isExtensionActive !== 'undefined' ? isExtensionActive : null);
  if (!fn) return false;
  return fn(settings, location.origin);
}

async function logDecision(entry) {
  try {
    const r = await chrome.storage.local.get(['log']);
    const log = Array.isArray(r.log) ? r.log : [];
    log.push({
      ts: new Date().toISOString(),
      origin: location.origin,
      action: entry.action || '',
      decision: entry.decision,
      reason: entry.reason || ''
    });
    await chrome.storage.local.set({ log: log.slice(-LOG_CAP) });
  } catch (e) {
    // Logging must never break the page.
  }
}


// classifyAction() comes from rules.js (globalThis first, lexical second).
// If it is somehow unavailable, fail safe: classify as ignore, never click.
function classify(text) {
  if (!CLASSIFY_FN) return { decision: 'ignore', reason: 'classifyAction unavailable', matchedRule: null };
  return CLASSIFY_FN(text, settings.allowList, settings.denyList);
}

// Find the nearest reasonable "card" container for a button.
function findCardContainer(button) {
  let el = button;
  for (let i = 0; i < 6 && el && el !== document.body; i++) {
    el = el.parentElement;
    if (!el) break;
    // A card is a container that holds the button plus descriptive text.
    const text = (el.innerText || '').trim();
    if (text.length > 40 && el.querySelectorAll('button').length >= 1) {
      return el;
    }
  }
  return button.parentElement || button;
}

function extractActionText(card) {
  const text = (card.innerText || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, MAX_ACTION_CHARS);
}

function findAllowButton(card) {
  const buttons = card.querySelectorAll('button');
  for (const b of buttons) {
    const label = (b.innerText || b.textContent || '').trim();
    if (ALLOW_RE.test(label)) return b;
  }
  return null;
}

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  return rect.width !== 0 || rect.height !== 0;
}

// Step 1 — REVIEW: open the approval panel.
// The banner text ("A task needs review") carries no action description,
// so it cannot be classified yet. Clicking Review is read-only navigation:
// it only reveals the panel, where step 2 classifies the real action
// before any Allow is clicked. A deny-listed action is therefore still
// never approved — its panel is opened, read, and left alone.
function scanForReviewButtons() {
  if (!isActiveForThisOrigin()) return;
  // NOTE: do NOT skip Review just because an Allow button is already
  // visible. In the Muse UI the approval panel can sit in the DOM with an
  // Allow button while the inline "A task needs review" banner is also
  // shown — and that Allow button may already have been processed (e.g.
  // classified ignore for a different card). Skipping Review then deadlocks
  // the whole flow: Review is never clicked and the processed Allow is
  // never clicked again. Review is read-only navigation, so clicking it
  // even when a panel is already open is harmless.
  if (Date.now() - lastReviewClickAt < REVIEW_CLICK_COOLDOWN_MS) return;

  // Review can be a <button>, a link, or a [role="button"] element — and in
  // some Muse UI builds it is a plain <div>/<span> with an onClick handler,
  // so try clickable elements first, then any element whose exact text is
  // "Review" (clicking a span inside a button bubbles to the button).
  const clickable = document.querySelectorAll('button, a, [role="button"]');
  const anyEl = document.querySelectorAll('div, span');
  const candidates = Array.from(clickable).concat(Array.from(anyEl));
  for (const el of candidates) {
    const label = (el.innerText || el.textContent || '').trim();
    if (!REVIEW_RE.test(label)) continue;
    if (el.disabled) continue;
    if (el.hasAttribute(REVIEW_PROCESSED_ATTR)) continue;
    // The Review label can live on both a <button> and the <span> inside
    // it — treat them as one control: if the enclosing button/link was
    // already processed, skip the span (and vice versa), so one banner is
    // clicked once, not once per nested element.
    const host = el.closest ? el.closest('button, a, [role="button"]') : null;
    if (host && host !== el && host.hasAttribute(REVIEW_PROCESSED_ATTR)) continue;
    if (!isVisible(el)) continue;

    el.setAttribute(REVIEW_PROCESSED_ATTR, '1');
    if (host && host !== el) host.setAttribute(REVIEW_PROCESSED_ATTR, '1');
    const banner = findCardContainer(el);
    const bannerText = extractActionText(banner);
    logDecision({ action: bannerText, decision: 'review', reason: 'opening approval panel — no approval yet' });
    // Same safety delay as Allow, then re-check before clicking.
    setTimeout(() => {
      if (!isActiveForThisOrigin()) return;
      if (!document.contains(el)) return;
      if (el.disabled) return;
      lastReviewClickAt = Date.now();
      el.click();
      logDecision({ action: bannerText, decision: 'review', reason: 'clicked Review after 800ms re-check; panel should now open' });
      // Re-scan after the panel opens: opening it may only change an
      // attribute (e.g. display) rather than adding nodes, and some UIs
      // mount the panel a beat later. The observer also watches attributes.
      setTimeout(scanAll, 600);
      setTimeout(scanAll, 1500);
    }, SAFETY_DELAY_MS);
    return; // one Review click at a time; the observer re-scans afterwards
  }
}

function scanForCards() {
  if (!isActiveForThisOrigin()) return;
  const buttons = document.querySelectorAll('button');
  for (const button of buttons) {
    const label = (button.innerText || button.textContent || '').trim();
    if (!ALLOW_RE.test(label)) continue;
    if (button.disabled) continue;
    if (button.hasAttribute(PROCESSED_ATTR)) continue;
    // Only consider visible buttons.
    if (!isVisible(button)) continue;

    const card = findCardContainer(button);
    const actionText = extractActionText(card);
    const result = classify(actionText);

    if (result.decision === 'allow') {
      // Only allow/deny are final: mark processed so the button is
      // clicked (allow) or left alone (deny) exactly once.
      button.setAttribute(PROCESSED_ATTR, '1');
      logDecision({ action: actionText, decision: 'allow', reason: result.reason + ' — clicking after safety delay' });
      // Safety delay + re-check before clicking.
      setTimeout(() => {
        if (!isActiveForThisOrigin()) return;
        if (!document.contains(button)) return; // card gone
        if (button.disabled) return;
        const freshCard = findCardContainer(button);
        const freshText = extractActionText(freshCard);
        const fresh = classify(freshText);
        if (fresh.decision !== 'allow') {
          // Unmark so a later scan can retry once the panel text settles
          // (same incomplete-text problem as the ignore case above).
          button.removeAttribute(PROCESSED_ATTR);
          logDecision({ action: freshText, decision: 'ignore', reason: 're-check after delay no longer allows: ' + fresh.reason });
          return;
        }
        button.click();
        logDecision({ action: freshText, decision: 'allow', reason: 'clicked Allow after 800ms re-check' });
      }, SAFETY_DELAY_MS);
    } else if (result.decision === 'deny') {
      button.setAttribute(PROCESSED_ATTR, '1');
      logDecision({ action: actionText, decision: 'deny', reason: result.reason + ' — NOT clicked' });
    } else {
      // ignore: do NOT mark processed. The button in Martin's screenshot
      // already carried data-muse-auto-allow-processed="1" without being
      // clicked — it was classified on incomplete panel text, then never
      // retried once the full text rendered. An ignored button stays
      // eligible, so a later scan (panel fully rendered) can still allow
      // it. Log the ignore once only, to avoid flooding the log on every
      // MutationObserver pass.
      if (actionText.length > 20 && !button.hasAttribute(IGNORE_LOGGED_ATTR)) {
        button.setAttribute(IGNORE_LOGGED_ATTR, '1');
        logDecision({ action: actionText, decision: 'ignore', reason: result.reason });
      }
    }
  }
}

function scanAll() {
  // Review FIRST, then Allow: the requested flow is Review → Allow, and
  // the Allow scan must not block Review (see scanForReviewButtons).
  scanForReviewButtons();
  scanForCards();
}

function startObserver() {
  if (!document.body) return;
  const observer = new MutationObserver(() => {
    scanAll();
  });
  // attributes:true so a panel that only toggles display/visibility (no
  // new nodes) still triggers a re-scan.
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  scanAll(); // also scan what is already on the page
}

loadSettings().then(() => {
  // Keep settings fresh (popup toggles) without re-injecting.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') loadSettings();
    });
  } catch (e) { /* ignore */ }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }
});
