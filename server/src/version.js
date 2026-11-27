'use strict';
// Which commit this server runs: baked into the image (server/Dockerfile REVISION), or Railway's. Shown to
// signed-in teachers (the dashboard's footer, the admin's Server page), never on the public pages.
const revision = process.env.BQ_REVISION || process.env.RAILWAY_GIT_COMMIT_SHA || '';
module.exports = { revision, version: revision.slice(0, 7) };
