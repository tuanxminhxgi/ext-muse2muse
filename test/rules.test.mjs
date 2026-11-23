// test/rules.test.mjs — unit tests for the pure classification logic in rules.js.
// Run: node test/rules.test.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { classifyAction, DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST, isAllowButtonLabel, isReviewButtonLabel, isExtensionActive } = require('../rules.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('ok - ' + name);
}

// 1. Allow: git push on tuanxminhxgi/agent-tools
check('allow rule matches git push on tuanxminhxgi/agent-tools', () => {
  const r = classifyAction(
    'Allow git push to tuanxminhxgi/agent-tools on branch reports-local-page',
    DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r.decision, 'allow');
});

// 2. Allow: git branch creation
check('allow rule matches git branch creation', () => {
  const r = classifyAction('Create git branch implement-b-bridge-ideas in tuanxminhxgi/muse2muse',
    DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r.decision, 'allow');
});

// 3. Allow: opening a PR
check('allow rule matches opening a pull request', () => {
  const r = classifyAction('Open a pull request from implement-b-groups12 into main',
    DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r.decision, 'allow');
});

// 4. Allow: reading files
check('allow rule matches reading files', () => {
  const r = classifyAction('Read files in tuanxminhxgi/agent-tools: web/src/local/pages/reports/',
    DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r.decision, 'allow');
});

// 5. Deny wins over allow: "merge pull request" also matches "pull request" allow rule
check('deny wins over allow for "merge pull request"', () => {
  const r = classifyAction('Merge pull request #11 into main (tuanxminhxgi/muse2muse)',
    DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /deny/);
});

// 6. Payment / billing denied
check('payment text is denied', () => {
  const r = classifyAction('Make a payment of $49 for billing / Stripe subscription',
    DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r.decision, 'deny');
});

// 7. Credentials / secrets / tokens denied
check('credential text is denied', () => {
  const r = classifyAction('Read the API token / password from credentials',
    DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r.decision, 'deny');
});

// 8. Delete / destructive denied
check('delete text is denied', () => {
  const r = classifyAction('Delete the production database and remove files',
    DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r.decision, 'deny');
});

// 9. Unrelated text ignored
check('unrelated text is ignored', () => {
  const r = classifyAction('Send a message to Martin on Telegram about the weather',
    DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r.decision, 'ignore');
});

// 10. Empty text ignored
check('empty text is ignored', () => {
  const r = classifyAction('   ', DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r.decision, 'ignore');
});

// 11. Deny wins even when an allow rule also matches (git push + delete)
check('deny wins when both lists match', () => {
  const r = classifyAction('git push then delete the remote branch',
    DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r.decision, 'deny');
});

// 12. Allow: "Get file contents on GitHub" — the Mailbox Check card in the
// screenshots (2026-11-23), read-only, tuanxminhxgi/muse2muse, main.
check('allow rule matches Get file contents on GitHub', () => {
  const r = classifyAction(
    'Allow Muse B to perform this action on your GitHub account for Muse B Mailbox Check? Muse B wants to retrieve file contents from the GitHub repository tuanxminhxgi/muse2muse on the main branch',
    DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r.decision, 'allow');
});

// 13. Allow: "Get commit on GitHub" — the other Mailbox Check card.
check('allow rule matches Get commit on GitHub', () => {
  const r = classifyAction(
    'Muse B wants to look up commit details for the main branch in tuanxminhxgi/muse2muse. This is for the scheduled task "Muse B Mailbox Check"',
    DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r.decision, 'allow');
});

// 14. Review button labels (step 1 of the v1.1.0 flow): exact "Review"
// opens the panel; "Allow"/"Approve" are step-2 labels, not Review.
check('Review label recognised, Allow/Approve are not Review', () => {
  assert.equal(isReviewButtonLabel('Review'), true);
  assert.equal(isReviewButtonLabel('review'), true);
  assert.equal(isReviewButtonLabel('Review ›'), true);
  assert.equal(isReviewButtonLabel('Allow'), false);
  assert.equal(isReviewButtonLabel('Approve'), false);
  assert.equal(isReviewButtonLabel('A task needs review'), false);
});

// 15. Allow/Approve button labels (step 2): Allow, Accept, Approve and
// the Vietnamese equivalents; "Review" is not an Allow label.
check('Allow/Approve labels recognised, Review is not Allow', () => {
  assert.equal(isAllowButtonLabel('Allow'), true);
  assert.equal(isAllowButtonLabel('Approve'), true);
  assert.equal(isAllowButtonLabel('Accept'), true);
  assert.equal(isAllowButtonLabel('Cho phép'), true);
  assert.equal(isAllowButtonLabel('Review'), false);
  assert.equal(isAllowButtonLabel('Deny'), false);
});

// 16. Deny still wins for a Get-file-contents card that also mentions a
// credential/token — opening its panel via Review must never auto-allow it.
check('deny wins for Get file contents card mentioning a token', () => {
  const r = classifyAction(
    'Get file contents on GitHub tuanxminhxgi/muse2muse containing the API token',
    DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r.decision, 'deny');
});

// 17. rules.js also copies its exports onto globalThis, so content.js
// can read them even if lexical sharing across content-script files fails.
check('rules exports are also on globalThis for content.js', () => {
  assert.equal(typeof globalThis.classifyAction, 'function');
  assert.equal(typeof globalThis.isReviewButtonLabel, 'function');
  assert.ok(Array.isArray(globalThis.DEFAULT_ALLOW_LIST));
  assert.equal(globalThis.isReviewButtonLabel('Review'), true);
});

// 18. Activation: ON when master on, not paused, origin enabled.
// Regression test for v1.1.0/v1.1.1: content.js had
// `if (!settings.paused) return false`, which left the extension inert
// in exactly the normal case (paused === false).
check('isExtensionActive is ON in the normal case, OFF when paused', () => {
  const base = { masterEnabled: true, paused: false, origins: { 'https://muse.ai': true } };
  assert.equal(isExtensionActive(base, 'https://muse.ai'), true);
  assert.equal(isExtensionActive({ ...base, paused: true }, 'https://muse.ai'), false);
  assert.equal(isExtensionActive({ ...base, masterEnabled: false }, 'https://muse.ai'), false);
  assert.equal(isExtensionActive({ ...base, origins: {} }, 'https://muse.ai'), false);
  assert.equal(isExtensionActive(null, 'https://muse.ai'), false);
});

// 19. GitHub actions added 2026-11-23 (v1.1.3), restrictions kept:
// "look up a specific commit", "push files", "change content", and the
// generic GitHub approval-card header.
check('allow rule matches look up a specific commit', () => {
  const r = classifyAction(
    'Muse B wants to look up a specific commit in GitHub. This is for the scheduled task "Muse B Mailbox Check". Action Get commit on GitHub Account tuanxminhxgi Repository owner tuanxminhxgi Repository muse2muse Commit 3a243ff91224a3ebc5634b70f99651b82745036',
    DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r.decision, 'allow');
});
check('allow rule matches push files / change content on GitHub', () => {
  const r = classifyAction(
    'Allow Muse B to perform this action on your GitHub account. Muse B wants to change content in your GitHub repository by pushing files.',
    DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r.decision, 'allow');
  const r2 = classifyAction(
    'Muse B wants to push a new package.json to the GitHub repository',
    DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r2.decision, 'allow');
});

// 20. Deny still wins even with the GitHub header present.
check('deny still wins for a GitHub merge card', () => {
  const r = classifyAction(
    'Allow Muse B to perform this action on your GitHub account. Merge pull request #11 into main',
    DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST);
  assert.equal(r.decision, 'deny');
});

console.log(`\n${passed} tests passed.`);
