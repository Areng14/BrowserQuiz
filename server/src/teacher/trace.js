// Trace a photo: the codes painted on the teacher's own students' quiz screens (screen marks, marks.js),
// so the dashboard can match the code it reads from a photo to an attempt. Only this teacher's runs.
const { q } = require('../db');
const P = require('../people');
const { json } = require('../http');
const { requireTeacher } = require('./common');

module.exports = function traceRoutes(r) {
  r.get('/api/t/marks', (req, res) => {
    const me = requireTeacher(req);
    const rows = q(`SELECT attempts.id, attempts.run_id, attempts.mark, runs.created_at AS run_at, quizzes.title AS quiz, rosters.name AS roster,
        bq_name(roster_students.name, roster_students.id, roster_students.roster_id) AS name
      FROM attempts JOIN runs ON runs.id = attempts.run_id JOIN quizzes ON quizzes.id = runs.quiz_id JOIN rosters ON rosters.id = runs.roster_id
      JOIN roster_students ON roster_students.id = attempts.student_id
      WHERE runs.owner_id = ? AND attempts.mark IS NOT NULL AND attempts.archived = 0
      ORDER BY attempts.created_at DESC LIMIT 5000`).all(me.id);
    const marks = [];
    for (const x of rows) {
      const code = P.tryField(x.run_id, x.id, 'mark', x.mark);
      if (code) marks.push({ code, attemptId: x.id, runId: x.run_id, name: x.name, quiz: x.quiz, roster: x.roster, at: x.run_at });
    }
    json(res, 200, { marks });
  });
};
