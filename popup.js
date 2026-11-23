// popup.js — master toggle, per-origin toggle, allow-list editor, log view.
'use strict';

const $ = (id) => document.getElementById(id);
let currentOrigin = '';

function setStatus(msg) {
  $('status').textContent = msg || '';
  if (msg) setTimeout(() => { $('status').textContent = ''; }, 3000);
}

function renderLog(log) {
  const ul = $('log');
  ul.innerHTML = '';
  const entries = (log || []).slice(-20).reverse();
  if (entries.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No decisions logged yet.';
    ul.appendChild(li);
    return;
  }
  for (const e of entries) {
    const li = document.createElement('li');
    const cls = e.decision === 'allow' ? 'allow' : e.decision === 'deny' ? 'deny-decision' : 'ignore';
    const time = e.ts ? new Date(e.ts).toLocaleTimeString() : '';
    li.innerHTML = '';
    const strong = document.createElement('strong');
    strong.className = cls;
    strong.textContent = e.decision.toUpperCase();
    li.appendChild(strong);
    li.appendChild(document.createTextNode(' ' + time + ' — ' + (e.action || '').slice(0, 120)));
    const small = document.createElement('div');
    small.className = 'note';
    small.textContent = e.reason || '';
    li.appendChild(small);
    ul.appendChild(li);
  }
}

function loadAll() {
  chrome.storage.sync.get(
    ['masterEnabled', 'paused', 'origins', 'allowList', 'denyList'],
    (s) => {
      $('masterToggle').checked = s.masterEnabled !== false;
      $('pauseToggle').checked = s.paused === true;
      const origins = s.origins || {};
      $('originToggle').checked = currentOrigin ? origins[currentOrigin] === true : false;
      $('allowList').value = (s.allowList || DEFAULT_ALLOW_LIST).join('\n');
      $('denyList').textContent = (s.denyList || DEFAULT_DENY_LIST).join('\n');
    }
  );
  chrome.storage.local.get(['log'], (r) => renderLog(r.log || []));
}

document.addEventListener('DOMContentLoaded', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].url) {
      try { currentOrigin = new URL(tabs[0].url).origin; } catch (e) { currentOrigin = ''; }
    }
    $('originLabel').textContent = currentOrigin || '(no tab origin)';
    loadAll();
  });

  $('masterToggle').addEventListener('change', (e) => {
    chrome.storage.sync.set({ masterEnabled: e.target.checked }, () => setStatus('Master ' + (e.target.checked ? 'enabled' : 'disabled')));
  });
  $('pauseToggle').addEventListener('change', (e) => {
    chrome.storage.sync.set({ paused: e.target.checked }, () => setStatus(e.target.checked ? 'Paused' : 'Resumed'));
  });
  $('originToggle').addEventListener('change', (e) => {
    chrome.storage.sync.get(['origins'], (s) => {
      const origins = s.origins || {};
      if (e.target.checked) origins[currentOrigin] = true;
      else delete origins[currentOrigin];
      chrome.storage.sync.set({ origins }, () => setStatus(e.target.checked ? 'Enabled for ' + currentOrigin : 'Disabled for ' + currentOrigin));
    });
  });
  $('saveAllowList').addEventListener('click', () => {
    const lines = $('allowList').value.split('\n').map((l) => l.trim()).filter(Boolean);
    // Validate each regex before saving.
    for (const line of lines) {
      try { new RegExp(line, 'i'); } catch (err) {
        setStatus('Invalid regex, not saved: ' + line);
        return;
      }
    }
    chrome.storage.sync.set({ allowList: lines }, () => setStatus('Allow-list saved (' + lines.length + ' rules)'));
  });
  $('clearLog').addEventListener('click', () => {
    chrome.storage.local.set({ log: [] }, () => { renderLog([]); setStatus('Log cleared'); });
  });
  $('exportLog').addEventListener('click', () => {
    chrome.storage.local.get(['log'], (r) => {
      const blob = new Blob([JSON.stringify(r.log || [], null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'muse-auto-allow-log.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  });
});
