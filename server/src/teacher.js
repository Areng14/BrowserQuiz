'use strict';
// Teacher API: sign in, upload quizzes and rosters, run quizzes, watch them live, act on attempts.
// The routes are in teacher/, a file for each part. Every one gets the teacher from requireTeacher and finds
// things through them (teacher/common.js and library.js), so another teacher's ids are simply not found.
module.exports = function teacherRoutes(r) {
  require('./teacher/auth')(r);
  require('./teacher/settings')(r);
  require('./teacher/quizzes')(r);
  require('./teacher/rosters')(r);
  require('./teacher/runs')(r);
  require('./teacher/live')(r);
  require('./teacher/attempts')(r);
  require('./teacher/grades')(r);
  require('./teacher/trace')(r);
  require('./teacher/server')(r);
};
