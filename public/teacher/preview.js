// Teacher preview: the student app against the teacher API. Nothing is recorded or saved.
(function () {
  'use strict';
  const id = new URLSearchParams(location.search).get('quiz') || '';
  const base = `/api/t/quizzes/${encodeURIComponent(id)}`;
  async function call(method, path, body) {
    const res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error('preview');
      // 404: the quiz was deleted, or edited (a save makes a new copy), since this tab opened
      err.code = res.status === 401 ? 'teacher_login' : res.status === 404 ? 'preview_gone' : (data && data.error) || 'network';
      throw err;
    }
    return data;
  }
  const api = {
    start: () => call('GET', base + '/preview'),
    run: (body) => call('POST', base + '/run', body),
    submit: (answers) => call('POST', base + '/grade', { answers }),
    event: async () => ({ ok: true }),
    beat: async () => ({ ok: true }),
    assetUrl: (p) => `${base}/asset?path=${encodeURIComponent(p)}`,
  };
  document.getElementById('pv-close').addEventListener('click', () => window.close());
  window.BQ.app.start(document.getElementById('bq-app'), api);
})();
