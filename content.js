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

// rules.js is loaded before this file in the same content-script world,
// so its top-level consts (ALLOW_BUTTON_RE, REVIEW_BUTTON_RE) are already
// declared here — redeclaring them would throw. Use distinct local names
// that pick up the shared ones when present, else fall back.
const ALLOW_RE = (typeof ALLOW_BUTTON_RE !== 'undefined' ? ALLOW_BUTTON_RE : /^(allow|accept|approve|cho phép|đồng ý)$/i);
const REVIEW_RE = (typeof REVIEW_BUTTON_RE !== 'undefined' ? REVIEW_BUTTON_RE : /^(review|xem xét|duyệt|xem lại)$/i);
const MAX_ACTION_CHARS = 500;
const SAFETY_DELAY_MS = 800;
// After clicking Review, give the panel time to appear before clicking
// another Review button (prevents double-opening / racing a second task).
const REVIEW_CLICK_COOLDOWN_MS = 2000;
const LOG_CAP = 200;
const PROCESSED_ATTR = 'data-muse-auto-allow-processed';
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
            allowList: Array.isArray(r.allowList) ? r.allowList : DEFAULT_ALLOW_LIST,
            denyList: Array.isArray(r.denyList) ? r.denyList : DEFAULT_DENY_LIST
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
  if (!settings.masterEnabled) return false;
  if (!settings.paused) return false;
  if (typeof window !== 'undefined' && window.__museAutoAllowPaused) return false;
  return settings.origins[location.origin] === true;
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
  // If an Allow button is already visible, the panel is open — no need
  // to click Review.
  const allowVisible = Array.from(document.querySelectorAll('button'))
    .some((b) => !b.disabled && ALLOW_RE.test((b.innerText || b.textContent || '').trim()) && isVisible(b));
  if (allowVisible) return;
  if (Date.now() - lastReviewClickAt < REVIEW_CLICK_COOLDOWN_MS) return;

  // Review can be a <button>, a link, or a [role="button"] element.
  const candidates = document.querySelectorAll('button, a, [role="button"]');
  for (const el of candidates) {
    const label = (el.innerText || el.textContent || '').trim();
    if (!REVIEW_RE.test(label)) continue;
    if (el.disabled) continue;
    if (el.hasAttribute(REVIEW_PROCESSED_ATTR)) continue;
    if (!isVisible(el)) continue;

    el.setAttribute(REVIEW_PROCESSED_ATTR, '1');
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
    const result = classifyAction(actionText, settings.allowList, settings.denyList);

    button.setAttribute(PROCESSED_ATTR, '1');

    if (result.decision === 'allow') {
      logDecision({ action: actionText, decision: 'allow', reason: result.reason + ' — clicking after safety delay' });
      // Safety delay + re-check before clicking.
      setTimeout(() => {
        if (!isActiveForThisOrigin()) return;
        if (!document.contains(button)) return; // card gone
        if (button.disabled) return;
        const freshCard = findCardContainer(button);
        const freshText = extractActionText(freshCard);
        const fresh = classifyAction(freshText, settings.allowList, settings.denyList);
        if (fresh.decision !== 'allow') {
          logDecision({ action: freshText, decision: 'ignore', reason: 're-check after delay no longer allows: ' + fresh.reason });
          return;
        }
        button.click();
        logDecision({ action: freshText, decision: 'allow', reason: 'clicked Allow after 800ms re-check' });
      }, SAFETY_DELAY_MS);
    } else if (result.decision === 'deny') {
      logDecision({ action: actionText, decision: 'deny', reason: result.reason + ' — NOT clicked' });
    } else {
      // ignore: only log when there was a nearby match of interest is not
      // possible without noise; log ignored cards that had descriptive text
      // so the user can see what the extension saw.
      if (actionText.length > 20) {
        logDecision({ action: actionText, decision: 'ignore', reason: result.reason });
      }
    }
  }
}

function scanAll() {
  scanForCards();
  scanForReviewButtons();
}

function startObserver() {
  if (!document.body) return;
  const observer = new MutationObserver(() => {
    scanAll();
  });
  observer.observe(document.body, { childList: true, subtree: true });
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
