// How a quiz is locked down: its mode, Safe Exam Browser's sound and the teacher's own .seb file, and the
// network lock. Give a quiz starts a quiz with these; Settings saves what it starts with.

import { h, tip } from './core.js';

// level: how locked down, out of 3.
// what: what students get, for a teacher who hasn't used it (shown on hover)
const MODES = [
  { id: 'exam', title: 'Exam', level: 2, security: 'Medium security',
    what: "The quiz runs in full screen in any browser. If a student leaves it for another tab, window or app, their quiz is invalidated and they aren't told." },
  { id: 'seb', title: 'Safe Exam Browser', level: 3, security: 'High security',
    what: "Students take the quiz in Safe Exam Browser, an app that locks the computer until they turn in. It must be installed on each student's computer." },
  { id: 'practice', title: 'Practice', level: 0, security: 'No security',
    what: "The quiz doesn't use full screen and nothing is flagged. Students see the right answers after they turn in." },
];
const START = { mode: 'exam', ipLock: false, sebMute: true, sebKey: '' };

// d: what it starts with ({ mode, ipLock, sebMute, sebKey }). pre: put before every id, so two of these
// can't clash. Returns { nodes, read() }: read() is what's picked, with sebKey only when it's used.
function lockdownFields(d, pre = '') {
  d = Object.assign({}, START, d || {});
  let mode = MODES.some((m) => m.id === d.mode) ? d.mode : 'exam';
  // Safe Exam Browser: BrowserQuiz makes the settings, unless the teacher has their own .seb file
  // (then its Config Key, from SEB Config Tool's Exam tab).
  const sebKey = h('input', { class: 'input t-mono', id: pre + 'seb-key', autocomplete: 'off', spellcheck: 'false', maxlength: '64', placeholder: '64 letters and digits', value: d.sebKey || null });
  const sebSummary = h('summary', { text: 'Use my own .seb file' });
  tip(sebSummary, sebSummary, "Use this if you made your own settings in SEB Config Tool. You give students your .seb file, and only Safe Exam Browser with those settings can join.");
  const sebOwn = h('details', { class: 't-seb', open: !!d.sebKey }, sebSummary,
    h('label', { class: 'field', for: pre + 'seb-key' }, h('span', { class: 'field-label', text: 'Config Key (SEB Config Tool, Exam tab)' }), sebKey));
  // SEB only: mute the computer's sound (other apps and tabs included) while the quiz is open
  const sebMute = h('input', { type: 'checkbox', id: pre + 'seb-mute', class: 't-switch', role: 'switch', checked: d.sebMute !== false });
  const muteRow = tip(h('label', { class: 't-check t-switch-row', for: pre + 'seb-mute' }, sebMute, h('span', { text: "Mute the computer's sound" })), sebMute,
    "Safe Exam Browser mutes the computer when it starts, so music or video playing in another app stops. Turn this off if a student uses a screen reader.");
  const paint = () => { sebOwn.hidden = mode !== 'seb'; muteRow.hidden = mode !== 'seb' || sebOwn.open; }; // their own file has its own sound setting
  sebOwn.addEventListener('toggle', () => { if (sebOwn.open && !sebKey.value) sebKey.focus(); paint(); });
  const cards = MODES.map((m) => {
    const input = h('input', { type: 'radio', name: pre + 'mode', id: pre + 'mode-' + m.id, value: m.id, checked: m.id === mode });
    input.addEventListener('change', () => { mode = m.id; paint(); });
    return tip(h('label', { class: 't-mode', for: pre + 'mode-' + m.id, 'data-level': String(m.level) }, input,
      h('span', { class: 't-mode-title', text: m.title }),
      h('span', { class: 't-mode-sec' },
        h('span', { class: 't-meter', 'aria-hidden': 'true' }, [1, 2, 3].map((i) => h('span', { class: i <= m.level ? 'on' : null }))),
        m.security)), input, m.what);
  });
  const ipLock = h('input', { type: 'checkbox', id: pre + 'ip-lock', class: 't-switch', role: 'switch', checked: !!d.ipLock });
  const ipRow = tip(h('label', { class: 't-check t-switch-row', for: pre + 'ip-lock' }, ipLock, h('span', { text: 'Only students on my current network' })),
    ipLock, "Students on a different network, such as at home, can't join.");
  paint();
  return {
    nodes: [h('fieldset', { class: 't-modes' }, h('legend', { class: 'field-label', text: 'Mode' }), cards), muteRow, sebOwn, ipRow],
    // keepKey: the Config Key as typed whatever the mode (Settings), instead of only when it's used now
    read: (keepKey) => ({
      mode, ipLock: ipLock.checked, sebMute: sebMute.checked,
      sebKey: (sebOwn.open && (keepKey || mode === 'seb') && sebKey.value.trim()) || '',
    }),
  };
}

export { MODES, lockdownFields };
