'use strict';

const { BASE_URL, STEALTH_API_URL } = require('../../config/env');

let _useStealthService = true;
let _browser = null;
let _apiPage = null;
let _initPromise = null;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

const LAUNCH_OPTS = {
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--window-size=1280,800',
  ],
};

function generateDid() {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function getPuppeteer() {
  const pptr = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  pptr.use(StealthPlugin());
  return pptr;
}

async function initializeLocalBrowser() {
  console.log('[browser] Launching local Puppeteer stealth browser...');
  const pptr = getPuppeteer();

  _browser = await pptr.launch(LAUNCH_OPTS);

  _browser.on('disconnected', () => {
    console.warn('[browser] Local browser disconnected — will re-launch on next request');
    _browser     = null;
    _apiPage     = null;
    _initPromise = null;
  });

  _apiPage = await _browser.newPage();
  await _apiPage.setUserAgent(UA);
  await _apiPage.setViewport({ width: 1280, height: 800 });

  await _apiPage.setRequestInterception(true);
  _apiPage.on('request', (req) => {
    const rt = req.resourceType();
    if (['image', 'font', 'media', 'stylesheet'].includes(rt)) req.abort();
    else req.continue();
  });

  console.log(`[browser] Navigating to ${BASE_URL} (CF challenge solve)...`);
  try {
    await _apiPage.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  } catch (err) {
    console.warn(`[browser] Navigation warning: ${err.message}`);
  }

  let cfClearance = null;
  const deadline = Date.now() + 15000;
  while (!cfClearance && Date.now() < deadline) {
    const cookies = await _apiPage.cookies().catch(() => []);
    const cf = cookies.find(c => c.name === 'cf_clearance');
    if (cf) cfClearance = cf.value;
    else await new Promise(r => setTimeout(r, 500));
  }

  if (cfClearance) {
    console.log('[browser] ✅ cf_clearance obtained — local API page ready');
  } else {
    console.warn('[browser] cf_clearance not found after 15 s — proceeding anyway');
  }
}

async function ensureLocalReady() {
  if (_browser && _browser.isConnected() && _apiPage && !_apiPage.isClosed()) return;
  if (_initPromise) return _initPromise;

  _initPromise = initializeLocalBrowser()
    .then(() => { _initPromise = null; })
    .catch((err) => {
      _initPromise = null;
      _browser     = null;
      _apiPage     = null;
      throw err;
    });

  return _initPromise;
}

async function localBrowserFetch(url, { method = 'GET', body, headers = {} } = {}) {
  await ensureLocalReady();

  const result = await _apiPage.evaluate(
    async (targetUrl, httpMethod, requestBody, extraHeaders) => {
      try {
        const opts = {
          method: httpMethod,
          credentials: 'include',
          headers: {
            'accept': '*/*',
            'accept-language': 'en-US,en;q=0.9',
            'cache-control': 'no-cache',
            'pragma': 'no-cache',
            ...extraHeaders,
          },
        };
        if (requestBody !== undefined) opts.body = requestBody;

        const res = await fetch(targetUrl, opts);
        const text = await res.text();
        return { status: res.status, ok: res.ok, text };
      } catch (e) {
        return { status: 0, ok: false, text: e.message };
      }
    },
    url, method, body, headers
  );

  if (result.status === 403 || (result.ok === false && result.text && result.text.includes('cf-'))) {
    console.warn('[browser] 403 on local browserFetch — re-initializing and retrying...');
    await invalidate();
    await ensureLocalReady();

    return _apiPage.evaluate(
      async (targetUrl, httpMethod, requestBody, extraHeaders) => {
        try {
          const opts = {
            method: httpMethod,
            credentials: 'include',
            headers: {
              'accept': '*/*',
              'accept-language': 'en-US,en;q=0.9',
              'cache-control': 'no-cache',
              'pragma': 'no-cache',
              ...extraHeaders,
            },
          };
          if (requestBody !== undefined) opts.body = requestBody;

          const res = await fetch(targetUrl, opts);
          const text = await res.text();
          return { status: res.status, ok: res.ok, text };
        } catch (e) {
          return { status: 0, ok: false, text: e.message };
        }
      },
      url, method, body, headers
    );
  }

  return result;
}

async function stealthServiceFetch(url, { method = 'GET', body, headers = {} } = {}) {
  const payload = {
    url,
    method,
    disableMedia: true,
    headers: {
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9',
      ...headers,
    }
  };
  if (body) payload.postData = body;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${STEALTH_API_URL}/v1/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[stealthClient] HTTP error from stealth service: ${res.status}`);
      return { status: res.status, ok: false, text: '' };
    }

    const data = await res.json();
    if (data.status !== 'ok' || !data.solution) {
      console.warn(`[stealthClient] Stealth failed to solve:`, data);
      return { status: 500, ok: false, text: '' };
    }

    return {
      status: data.solution.status,
      ok: data.solution.status >= 200 && data.solution.status < 300,
      text: data.solution.response || ''
    };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function browserFetch(url, opts = {}) {
  if (_useStealthService && STEALTH_API_URL) {
    try {
      const res = await stealthServiceFetch(url, opts);
      return res;
    } catch (err) {
      console.warn(`[stealthClient] External stealth service unavailable (${err.message}). Falling back to local Puppeteer stealth browser...`);
      _useStealthService = false;
    }
  }

  return localBrowserFetch(url, opts);
}

async function fetchHtml(url) {
  const res = await browserFetch(url, {
    headers: {
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    }
  });

  if (!res.ok) {
    console.warn(`[browser] fetchHtml warning: ${res.status} on ${url}`);
  }

  return res.text || '';
}

async function getCookieHeader() {
  if (process.env.CF_CLEARANCE) {
    const did = process.env.DID || generateDid();
    const locale = process.env.NEXT_LOCALE || 'en';
    return `cf_clearance=${process.env.CF_CLEARANCE}; did=${did}; NEXT_LOCALE=${locale}`;
  }

  if (!_useStealthService && _browser && _browser.isConnected() && _apiPage && !_apiPage.isClosed()) {
    try {
      const cookies = await _apiPage.cookies();
      const cookieMap = Object.fromEntries(cookies.map(c => [c.name, c.value]));
      const parts = [];
      if (cookieMap.cf_clearance) parts.push(`cf_clearance=${cookieMap.cf_clearance}`);
      parts.push(`did=${cookieMap.did || generateDid()}`);
      if (cookieMap.NEXT_LOCALE) parts.push(`NEXT_LOCALE=${cookieMap.NEXT_LOCALE}`);
      if (cookieMap._ga) parts.push(`_ga=${cookieMap._ga}`);
      return parts.join('; ');
    } catch (_) {}
  }

  return '';
}

async function invalidate() {
  console.log('[browser] Closing local browser (will re-launch on next request)');
  if (_browser) {
    await _browser.close().catch(() => {});
  }
  _browser     = null;
  _apiPage     = null;
  _initPromise = null;
}

process.on('exit', () => { if (_browser) _browser.close().catch(() => {}); });
process.on('SIGINT', async () => { await invalidate(); process.exit(0); });
process.on('SIGTERM', async () => { await invalidate(); process.exit(0); });

module.exports = { browserFetch, fetchHtml, getCookieHeader, invalidate };
