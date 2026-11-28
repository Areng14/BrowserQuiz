// Trace a photo, off the page's thread: find the photo's long straight lines, read them one by one (stopping
// once two agree), and match what was read against the teacher's codes. marks.js, reader.js, find.js.
importScripts('marks.js', 'reader.js', 'find.js');

onmessage = (e) => {
  const { bmp, codes } = e.data;
  try {
    // a phone photo is about 4000 pixels across; 3400 keeps the marks' detail and reads faster
    const k = Math.min(1, 3400 / Math.max(bmp.width, bmp.height));
    const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const found = self.BQFind.findLines(img).slice(0, 8);
    const reads = [];
    for (let i = 0; i < found.length; i++) {
      if (self.BQReader.combine(reads, []).sure) break;
      postMessage({ type: 'reading', i: i + 1, n: found.length });
      try { reads.push(self.BQReader.decodeLine(img, found[i].p1, found[i].p2)); } catch (err) { /* a line it can't read */ }
    }
    const all = self.BQReader.combine(reads, codes);
    const back = (p) => ({ x: p.x / k, y: p.y / k });
    postMessage({ type: 'done', code: all.code, sure: all.sure, agree: all.agree,
      ranked: all.ranked.map((x) => ({ code: x.code, score: x.score })), lines: all.used.map((l) => l.ends.map(back)) });
  } catch (err) {
    postMessage({ type: 'error' });
  }
};
