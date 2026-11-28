'use strict';
// The page a browser gets when a page (not the API) fails: the status, large, what it means, and one way on.
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'error.html'), 'utf8');
// The ones the address is to blame for go back to the start; anything else is ours, so the same address again.
const WRONG_ADDRESS = { 400: "That address isn't right", 403: "You can't open this page", 404: 'Page not found', 405: "That address isn't right" };

// Whether a request is a browser asking for a page, which gets this instead of plain words.
const wantsPage = (req) => req.method === 'GET' && !req.url.startsWith('/api/') && String(req.headers.accept || '').includes('text/html');

function errorPage(status, pathname) {
  const title = WRONG_ADDRESS[status] || 'Something went wrong';
  const fill = { status, title, href: WRONG_ADDRESS[status] ? (pathname.startsWith('/teacher') ? '/teacher/' : '/') : '', button: WRONG_ADDRESS[status] ? 'Go to the start' : 'Try again' };
  return PAGE.replace(/{{(\w+)}}/g, (_, k) => String(fill[k]));
}

module.exports = { errorPage, wantsPage };
