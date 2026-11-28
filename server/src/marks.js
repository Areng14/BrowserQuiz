// Screen marks: each attempt in an exam (not practice) gets a short code that the quiz screen paints, faintly, into
// its lines. A photo of the screen read back (Trace a photo, in the dashboard) gives the code, and the code
// the attempt. The code is sealed with the teacher's key like the rest of the attempt (people.js).
const crypto = require('crypto');
const { q } = require('./db');
const P = require('./people');

const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford's base 32: no I, L, O or U

// The codes already given in this run, so two students in one quiz never share one.
function runMarks(runId) {
  const taken = new Set();
  for (const r of q('SELECT id, mark FROM attempts WHERE run_id = ? AND mark IS NOT NULL').all(runId)) {
    const code = P.tryField(runId, r.id, 'mark', r.mark);
    if (code) taken.add(code);
  }
  return taken;
}

// A new code for an attempt in this run, sealed for storing; null for practice.
function newMark(run, attemptId) {
  if (run.mode === 'practice') return null;
  const taken = runMarks(run.id);
  let code;
  do code = Array.from(crypto.randomBytes(5), (b) => ALPHA[b & 31]).join(''); while (taken.has(code));
  return P.sealField(run.id, attemptId, 'mark', code);
}

module.exports = { ALPHA, newMark };
