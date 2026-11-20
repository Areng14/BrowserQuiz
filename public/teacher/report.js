// Printable report: each question with the student's answer and the correct one.
// /teacher/report.html?attempt=<id> for one student, ?run=<id> for everyone who submitted.
(function () {
  'use strict';
  const root = document.getElementById('r-root');
  const status = document.getElementById('r-status');
  const printBtn = document.getElementById('r-print');
  const jump = document.getElementById('r-jump');
  const { student, classOverview, highlight, h } = window.BQReport;

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
    const many = data.students.length > 1;
    const pages = data.students.map((s, i) => student(data.quiz, s, { assetUrl, key: `s${i}` }));
    root.replaceChildren(...(many ? [classOverview(data.quiz, data.students)] : []), ...pages);
    if (many) {
      jump.replaceChildren(h('option', { value: '', text: 'Jump to a student' }), ...data.students.map((s, i) => h('option', { value: `s${i}`, text: s.name })));
      jump.hidden = false;
      jump.addEventListener('change', () => { if (jump.value) document.getElementById(jump.value).scrollIntoView(); jump.value = ''; });
    }
    status.textContent = many ? `${data.students.length} students` : '';
    printBtn.disabled = true;
    await highlight(root); // colors first, so the PDF has them
    printBtn.disabled = false;
  }

  printBtn.addEventListener('click', () => window.print());
  load();
})();
