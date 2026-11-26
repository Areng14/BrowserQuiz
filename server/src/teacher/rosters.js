'use strict';
// Classes: from a CSV or a pasted list, edited, archived.

const { readJson, json } = require('../http');
const crypto = require('node:crypto');
const { tx, q } = require('../db');
const P = require('../people');
const { hashSid } = require('../student');
const { audit, getRoster, parseCsv, requireTeacher } = require('./common');
const { parseRosterText, parseTimeX, retireRoster } = require('./library');

module.exports = function rosterRoutes(r) {
  // New class from a CSV file ({ csv }) or the roster maker's pasted list ({ text }).
  r.post('/api/t/rosters', async (req, res) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 2 * 1024 * 1024);
    const name = String(body.name || '').trim().slice(0, 80) || 'Class';
    let students = [];
    let problems = [];
    if (typeof body.text === 'string') {
      ({ students, problems } = parseRosterText(body.text));
      if (!students.length && !problems.length) problems.push('Add at least one student.');
    } else {
      const rows = parseCsv(body.csv || '');
      if (rows.length < 2) return json(res, 400, { error: 'bad_roster', message: 'The CSV needs a header row and at least one student.' });
      const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
      const ni = header.indexOf('name');
      const si = header.findIndex((h) => h === 'student_id' || h === 'id' || h === 'studentid');
      if (ni < 0 || si < 0) return json(res, 400, { error: 'bad_roster', message: 'The header row needs "name" and "student_id" columns.' });
      rows.slice(1).forEach((r2, i) => {
        const n = String(r2[ni] || '').trim().slice(0, 80);
        const sid = String(r2[si] || '').trim().slice(0, 40);
        if (!n || !sid) problems.push(`Row ${i + 2} is missing a name or student ID.`);
        else students.push({ name: n, sid });
      });
    }
    if (problems.length) return json(res, 400, { error: 'bad_roster', message: problems.slice(0, 5).join(' ') });
    if (students.length > 500) return json(res, 400, { error: 'bad_roster', message: 'A class can have at most 500 students.' });
    const id = crypto.randomUUID();
    tx(() => {
      q('INSERT INTO rosters (id, name, created_at, owner_id) VALUES (?, ?, ?, ?)').run(id, name, Date.now(), me.id);
      for (const s of students) {
        const sid = crypto.randomUUID();
        q('INSERT INTO roster_students (id, roster_id, name, sid_hash, time_x) VALUES (?, ?, ?, ?, ?)').run(sid, id, P.sealName(me.id, sid, s.name), hashSid(s.sid), s.timeX || 1);
      }
    });
    audit(me, 'create-roster', null, `${name} (${students.length})`);
    json(res, 200, { id, name, students: students.length });
  });

  // Roster maker: IDs are stored hashed, so a class can be renamed and students added or removed,
  // but an existing ID can't be shown.
  r.get('/api/t/rosters/:id', (req, res, p) => {
    const me = requireTeacher(req);
    const roster = getRoster(me, p.id);
    const students = q(`SELECT s.id, bq_name(s.name, s.id, s.roster_id) AS name, s.time_x, EXISTS(SELECT 1 FROM attempts a WHERE a.student_id = s.id) AS results
      FROM roster_students s WHERE s.roster_id = ? AND s.removed = 0 ORDER BY name`).all(roster.id)
      .map((x) => ({ id: x.id, name: x.name, results: !!x.results, timeX: x.time_x || 1 }));
    json(res, 200, { id: roster.id, name: roster.name, students });
  });

  r.post('/api/t/rosters/:id/edit', async (req, res, p) => {
    const me = requireTeacher(req);
    const body = await readJson(req, 2 * 1024 * 1024);
    const roster = getRoster(me, p.id);
    const { students, problems } = parseRosterText(body.add || '');
    if (problems.length) return json(res, 400, { error: 'bad_roster', message: problems.slice(0, 5).join(' ') });
    const remove = Array.isArray(body.remove) ? body.remove.map(String) : [];
    tx(() => {
      const name = String(body.name || '').trim().slice(0, 80);
      if (name) q('UPDATE rosters SET name = ? WHERE id = ?').run(name, roster.id);
      for (const s of students) {
        const sid = crypto.randomUUID();
        q('INSERT INTO roster_students (id, roster_id, name, sid_hash, time_x) VALUES (?, ?, ?, ?, ?)').run(sid, roster.id, P.sealName(me.id, sid, s.name), hashSid(s.sid), s.timeX || 1);
      }
      // extra time per student: { roster student id: 1 | 1.25 | 1.5 | 2 }; a quiz already started keeps its clock
      if (body.time && typeof body.time === 'object') {
        for (const [sid, v] of Object.entries(body.time).slice(0, 500)) q('UPDATE roster_students SET time_x = ? WHERE id = ? AND roster_id = ?').run(parseTimeX(v), String(sid), roster.id);
      }
      for (const sid of remove) {
        // Students with quiz results stay in the database (hidden) so old results keep their names.
        if (q('SELECT 1 FROM attempts WHERE student_id = ? LIMIT 1').get(sid)) q('UPDATE roster_students SET removed = 1 WHERE id = ? AND roster_id = ?').run(sid, roster.id);
        else q('DELETE FROM roster_students WHERE id = ? AND roster_id = ?').run(sid, roster.id);
      }
    });
    audit(me, 'edit-roster', null, `${roster.name}: +${students.length} -${remove.length}`);
    json(res, 200, { ok: true });
  });

  r.post('/api/t/rosters/:id/delete', async (req, res, p) => {
    const me = requireTeacher(req);
    const roster = getRoster(me, p.id, true);
    retireRoster(roster.id);
    audit(me, 'delete-roster', null, roster.name);
    json(res, 200, { ok: true });
  });
};
