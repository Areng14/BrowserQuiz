// BrowserQuiz student app: join → type your name → wait for admit → rules → fullscreen quiz → submitted.
// The student never learns anything about integrity from this UI. The server keeps all of that.
// Each part of it is a module in this folder; this one starts it (window.BQ.app).

import { BQ, S, api, cfg, resetState, setUp } from './state.js';
import { exitFullscreen } from './dom.js';
import { pageParams } from './theme.js';
import { screenJoin, screenRules } from './entry.js';
import { disposeEditor } from './quiz.js';
import { screenContinue } from './overlays.js';
import { startPreview, startWatch } from './done.js';
import { watchView } from './watch.js';

// ---------- lifecycle ----------
function teardown() {
  if (!S) return;
  clearInterval(S.timer);
  clearInterval(S.poll);
  disposeEditor();
  if (S.monitor) S.monitor.disarm();
  Object.values(S.models).forEach((m) => m && !m.isDisposed() && m.dispose());
  exitFullscreen();
}

BQ.app = {
  start(el, apiImpl) {
    setUp(el, apiImpl || BQ.api);
    resetState();
    if (cfg.watch) { startWatch(); return; }
    if (cfg.preview) { startPreview(); return; }
    if (!api.resume) { screenJoin(); return; }
    let code = null;
    try {
      const ps = pageParams();
      code = ps.get('code');
      if (code || ps.has('theme')) {
        ps.delete('code');
        ps.delete('theme');
        const rest = ps.toString();
        history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
      }
    } catch (e) { /* no code */ }
    // Already signed in on this browser (say, after a reload)? Pick up where they were.
    api.resume().then((r) => {
      if (!r || !r.status) return screenJoin(null, code);
      S.run = r.run;
      S.me = { name: r.name };
      // not started yet: the rules again (agreeing goes back into lockdown; doing it twice counts as
      // reopening, server /api/ready)
      if (r.status === 'waiting' || r.status === 'admitted') return screenRules();
      if (r.status === 'active') return screenContinue(!!r.paused);
      return screenJoin(null, code); // turned in already: free to join the next quiz
    }).catch(() => screenJoin(null, code));
  },
  restart() {
    teardown();
    if (api && api.reset) api.reset();
    resetState();
    screenJoin();
  },
  // Teacher watch page: follow the student's screen and answers. False until the quiz is on screen.
  watch: (view, answers, extra) => watchView(view, answers, extra),
};

export { teardown };
