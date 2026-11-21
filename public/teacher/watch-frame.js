// The student's quiz as they see it, inside the teacher's Watch page (watch.js drives it). Read-only:
// nothing here sends anything for the student.
(function () {
  'use strict';
  const id = new URLSearchParams(location.search).get('attempt') || '';
  let quizId = '';
  async function get(path) {
    const res = await fetch(path, { credentials: 'same-origin' });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error('watch');
      err.code = res.status === 401 ? 'teacher_login' : (data && data.error) || 'network';
      throw err;
    }
    return data;
  }
  const no = async () => { throw Object.assign(new Error('watch'), { code: 'watch_only' }); };
  const api = {
    start: async () => {
      const r = await get(`/api/t/attempts/${encodeURIComponent(id)}/watch-start`);
      quizId = r.quizId;
      return r;
    },
    run: no,
    submit: no,
    event: async () => ({ ok: true }),
    beat: async () => ({ ok: true }),
    assetUrl: (p) => `/api/t/quizzes/${encodeURIComponent(quizId)}/asset?path=${encodeURIComponent(p)}`,
  };
  window.BQ.app.start(document.getElementById('bq-app'), api);
})();
