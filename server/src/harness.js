'use strict';
// Builds the wrapper that calls the student's code for each test, and reads the results back.
// The sandbox only ever gets code + inputs; expected values stay here and are compared here.
// The parts are in jobs/; the harness's own files for each language (BQJ.java, bqh.py, ...) in harness/.
const { javaType, pyType } = require('./jobs/literals');
const { starterCode, callText, expectedText, show } = require('./jobs/show');
const { buildJob, buildSnippetJob } = require('./jobs/build');
const { readResults, studentView, same, clean, cleanCc, cleanJs, cleanGo, cleanRust, cleanCs } = require('./jobs/results');

module.exports = { buildJob, readResults, studentView, starterCode, callText, expectedText, same, show, clean, javaType, pyType, buildSnippetJob, cleanCc, cleanJs, cleanGo, cleanRust, cleanCs };
