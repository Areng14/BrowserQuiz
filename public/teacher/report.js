// Printable report: each question with the student's answer and the correct one.
// /teacher/report.html?attempt=<id> for one student, ?run=<id> for everyone who submitted.
(function () {
  'use strict';
  const root = document.getElementById('r-root');
  const status = document.getElementById('r-status');
  const printBtn = document.getElementById('r-print');
  const { student } = window.BQReport;

  async function load() {
    const params = new URLSearchParams(location.search);
    const practice = params.has('practice'); // a student reviewing their own practice attempt
    const url = practice ? '/api/practice-review'
      : params.get('attempt') ? `/api/t/attempts/${encodeURIComponent(params.get('attempt'))}/report`
        : params.get('run') ? `/api/t/runs/${encodeURIComponent(params.get('run'))}/report` : null;
    if (!url) { status.textContent = 'No report selected.'; return; }
    status.textContent = practice ? 'Grading…' : 'Loading…';
    let res;
    try { res = await fetch(url, { credentials: 'same-origin' }); } catch (e) { status.textContent = "Can't reach the server."; return; }
    if (res.status === 401) { status.textContent = practice ? 'Sign in to the quiz first.' : 'Sign in on the teacher page, then reload this page.'; return; }
    if (!res.ok) { status.textContent = `Couldn't load the report (${res.status}).`; return; }
    const data = await res.json();
    document.title = data.students.length === 1 ? `${data.quiz.title} - ${data.students[0].name}` : `${data.quiz.title} - class report`;
    if (!data.students.length) { status.textContent = 'Nobody has submitted yet.'; return; }
    const assetUrl = practice ? (p) => '/asset/' + String(p).split('/').map(encodeURIComponent).join('/') : null;
    root.replaceChildren(...data.students.map((s) => student(data.quiz, s, { assetUrl })));
    status.textContent = data.students.length === 1 ? '' : `${data.students.length} students, one per page`;
    printBtn.disabled = false;
  }

  printBtn.addEventListener('click', () => window.print());
  load();
})();
