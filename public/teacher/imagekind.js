// What a quiz image (other than a diagram, svg.js) really is, read from its first bytes rather than its name:
// png, jpeg, gif or webp. Random bytes renamed .png, a zero-filled file or a phone's HEIC photo are none of
// them, and no browser would show them. Shared by the server (uploads and the quiz maker's saves) and the quiz
// maker (as an image is picked).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BQImageKind = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const has = (b, at, text) => [...text].every((c, k) => b[at + k] === c.charCodeAt(0));
  // b: the file's bytes, or its first 12 or more (a Buffer or Uint8Array). null: not one of the four.
  function mime(b) {
    if (b[0] === 0x89 && has(b, 1, 'PNG\r\n\x1a\n')) return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (has(b, 0, 'GIF87a') || has(b, 0, 'GIF89a')) return 'image/gif';
    if (has(b, 0, 'RIFF') && has(b, 8, 'WEBP')) return 'image/webp';
    return null;
  }
  return { mime, NOT_IMAGE: "isn't really a png, jpg, gif or webp image." };
}));
