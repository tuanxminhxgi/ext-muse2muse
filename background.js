// background.js — minimal service worker: seed defaults on install.
'use strict';

importScripts('rules.js'); // DEFAULT_ALLOW_LIST / DEFAULT_DENY_LIST (pure logic, no chrome APIs)

const DEFAULT_SETTINGS = {
  masterEnabled: true,          // master kill switch (default ON once installed)
  paused: false,                // popup toggle escape hatch
  origins: {},                  // { origin: true } — per-origin gate, default OFF (empty)
  allowList: (typeof DEFAULT_ALLOW_LIST !== 'undefined') ? DEFAULT_ALLOW_LIST.slice() : [],
  denyList: (typeof DEFAULT_DENY_LIST !== 'undefined') ? DEFAULT_DENY_LIST.slice() : []
};

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.get(
      ['masterEnabled', 'paused', 'origins', 'allowList', 'denyList'],
      (existing) => {
        const seed = {};
        if (existing.masterEnabled === undefined) seed.masterEnabled = DEFAULT_SETTINGS.masterEnabled;
        if (existing.paused === undefined) seed.paused = DEFAULT_SETTINGS.paused;
        if (existing.origins === undefined) seed.origins = DEFAULT_SETTINGS.origins;
        if (existing.allowList === undefined) seed.allowList = DEFAULT_SETTINGS.allowList;
        if (existing.denyList === undefined) seed.denyList = DEFAULT_SETTINGS.denyList;
        if (Object.keys(seed).length > 0) {
          chrome.storage.sync.set(seed);
        }
        chrome.storage.local.get(['log'], (r) => {
          if (!Array.isArray(r.log)) chrome.storage.local.set({ log: [] });
        });
      }
    );
  }
});
