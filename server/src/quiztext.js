'use strict';
// A quiz.json as text, uploaded on its own or inside a .quiz: saved by whatever the teacher had to hand, so not
// always UTF-8, and not always starting on its first byte.

// UTF-8, or UTF-16 as Windows saves "Unicode" text, known by its byte order mark or by the zero byte beside
// each ASCII character. A byte order mark is dropped. end: only that many bytes.
function textOf(buf, end) {
  const enc = buf[0] === 0xff && buf[1] === 0xfe ? 'utf-16le' : buf[0] === 0xfe && buf[1] === 0xff ? 'utf-16be'
    : buf[0] && buf[1] === 0 ? 'utf-16le' : buf[0] === 0 && buf[1] ? 'utf-16be' : 'utf-8';
  return new TextDecoder(enc).decode(end ? buf.subarray(0, end) : buf);
}

// An upload that's a quiz.json rather than a .quiz: its text, which past any blank space starts with a {. null:
// it's something else (a zip, an image). Only the start is read to tell, so a .quiz isn't decoded as text.
function quizJsonText(buf) {
  const head = textOf(buf, 65536).trimStart();
  return head.startsWith('{') || (!head && buf.length > 65536) ? textOf(buf) : null;
}

module.exports = { textOf, quizJsonText };
