// Real server API. Every student response is shaped the same whatever the integrity state:
// the server never tells the client about strikes or invalidation.
(function () {
  'use strict';
  const BQ = (window.BQ = window.BQ || {});

  // Safe Exam Browser's newer engine (SEB for iPad, newer Macs) can't add its Config Key header to
  // requests. It gives the page the hash for the page's own address instead ("security.configKey", ':'
  // until it's ready), and that address and hash go with every request (server: requireSeb).
  // The address can change after load (the app drops ?code=), so the first one goes along too.
  const firstPage = location.href;
  let seb = null;
  const sebReady = new Promise((done) => {
    const api = window.SafeExamBrowser && window.SafeExamBrowser.security;
    if (!api) return done();
    const take = () => {
      const k = api.configKey;
      if (typeof k === 'string' && /^[0-9a-f]{64}$/i.test(k)) seb = { page: location.href, first: firstPage, key: k };
    };
    take();
    if (seb || typeof api.updateKeys !== 'function') return done();
    let over = false;
    const finish = () => { if (!over) { over = true; take(); done(); } };
    try { api.updateKeys(finish); } catch (e) { finish(); }
    setTimeout(finish, 3000);
  });

  async function post(path, body, keepalive) {
    await sebReady;
    let res;
    try {
      res = await fetch(path, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, seb ? { 'X-BQ-SEB-Page': seb.page, 'X-BQ-SEB-First': seb.first, 'X-BQ-SEB-Key': seb.key } : {}),
        credentials: 'same-origin',
        body: JSON.stringify(body || {}),
        keepalive: !!keepalive,
      });
    } catch (e) {
      const err = new Error('network');
      err.code = 'network';
      throw err;
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'network');
      err.code = (data && data.error) || 'network';
      throw err;
    }
    return data;
  }

  BQ.api = {
    join: (code) => post('/api/join', { code }),
    // Typeahead: only names matching what the student typed come back, never the whole roster.
    findNames: (body) => post('/api/names', body),
    attempt: (body) => post('/api/attempt', body),
    admitStatus: () => post('/api/admit-status'),
    start: () => post('/api/start'),
    event: (type, detail) => post('/api/event', { type, detail }, true),
    beat: (payload) => post('/api/beat', payload),
    run: (body) => post('/api/run', body),
    // keepalive lets a submit survive the page closing, but browsers cap keepalive bodies at 64 KB.
    submit: (answers) => post('/api/submit', { answers }, JSON.stringify(answers || {}).length < 60000),
    resume: () => post('/api/resume'),
    practiceRetry: () => post('/api/practice-retry'),
    assetUrl: (p) => '/asset/' + String(p).split('/').map(encodeURIComponent).join('/') + (seb ? `?seb=${encodeURIComponent(seb.page)}&sebfirst=${encodeURIComponent(seb.first)}&sebkey=${seb.key}` : ''),
  };
})();
