// Real server API. Every student response is shaped the same whatever the integrity state:
// the server never tells the client about strikes or invalidation.
(function () {
  'use strict';
  const BQ = (window.BQ = window.BQ || {});

  async function post(path, body, keepalive) {
    let res;
    try {
      res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    assetUrl: (p) => '/asset/' + String(p).split('/').map(encodeURIComponent).join('/'),
  };
})();
