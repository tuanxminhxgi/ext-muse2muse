// rules.js — pure classification logic, no chrome APIs.
// Safe to import from Node tests and from the content script / popup.
//
// Decision order:
//   1. Hard DENY list (checked FIRST, always wins)
//   2. Allow list (only then may the card be auto-allowed)
//   3. No match -> ignore (do nothing)

'use strict';

// Default allow-list: regex source strings (one per line in the popup).
// Scoped to Martin's repos under tuanxminhxgi/ and the scheduled-job context.
const DEFAULT_ALLOW_LIST = [
  'git\\s+branch',
  'git\\s+push',
  'git\\s+commit',
  'create\\s+(a\\s+)?pull\\s+request',
  'open\\s+(a\\s+)?pull\\s+request',
  'pull\\s+request',
  'read(ing)?\\s+files?',
  'tuanxminhxgi\\/'
];

// Default hard DENY-list: regex source strings. Checked first, always wins.
const DEFAULT_DENY_LIST = [
  'merge\\s+pull\\s+request',
  'merge\\s+(a\\s+)?(pr|pull)',
  'payment',
  'billing',
  'credential',
  'secret',
  'password',
  'token',
  'api\\s*key',
  'delete',
  'remove\\s+.*(file|branch|repo|database)',
  'destructive',
  'install',
  'run\\s+.*(binary|executable|script)',
  'sudo',
  'rm\\s+-rf'
];

function compilePatterns(sources) {
  const out = [];
  for (const src of sources || []) {
    const s = String(src || '').trim();
    if (!s) continue;
    try {
      out.push({ source: s, re: new RegExp(s, 'i') });
    } catch (e) {
      // Invalid user regex: skip it rather than breaking classification.
      out.push({ source: s, re: null, error: String(e && e.message || e) });
    }
  }
  return out;
}

/**
 * Classify an approval card's action text.
 * @param {string} actionText - descriptive text of the requested action.
 * @param {string[]} allowList - regex source strings (default DEFAULT_ALLOW_LIST).
 * @param {string[]} denyList  - regex source strings (default DEFAULT_DENY_LIST).
 * @returns {{decision: 'allow'|'deny'|'ignore', reason: string, matchedRule: string|null}}
 */
function classifyAction(actionText, allowList, denyList) {
  const text = String(actionText || '').trim();
  if (!text) {
    return { decision: 'ignore', reason: 'empty action text', matchedRule: null };
  }

  const deny = compilePatterns(denyList || DEFAULT_DENY_LIST);
  for (const p of deny) {
    if (p.re && p.re.test(text)) {
      return {
        decision: 'deny',
        reason: 'matched hard deny rule: ' + p.source,
        matchedRule: p.source
      };
    }
  }

  const allow = compilePatterns(allowList || DEFAULT_ALLOW_LIST);
  for (const p of allow) {
    if (p.re && p.re.test(text)) {
      return {
        decision: 'allow',
        reason: 'matched allow rule: ' + p.source,
        matchedRule: p.source
      };
    }
  }

  return { decision: 'ignore', reason: 'no allow rule matched', matchedRule: null };
}

// Export for Node (tests) and for browser content scripts (window/global).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { classifyAction, DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST, compilePatterns };
}
