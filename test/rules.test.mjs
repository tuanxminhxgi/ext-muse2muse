// test/rules.test.mjs — unit tests for the pure classification logic in rules.js.
// Run: node test/rules.test.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { classifyAction, DEFAULT_ALLOW_LIST, DEFAULT_DENY_LIST } = require('../rules.js');

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

console.log(`\n${passed} tests passed.`);
