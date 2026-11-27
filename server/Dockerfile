# BrowserQuiz app: student app, teacher dashboard and API. Build from the repo root:
#   docker build -f server/Dockerfile -t browserquiz-app .
FROM node:22-bookworm-slim AS editor
WORKDIR /src
COPY package.json package-lock.json ./
# Only behind a TLS-intercepting proxy (some school networks): pass the proxy's CA certificate. It's
# a public certificate, so a build argument is fine (and hosts like Railway don't take build secrets).
#   docker build --build-arg EXTRA_CA="$(cat /path/to/ca.crt)" -f server/Dockerfile -t browserquiz-app .
ARG EXTRA_CA=""
RUN if [ -n "$EXTRA_CA" ]; then printf '%s\n' "$EXTRA_CA" > /tmp/extra-ca.crt; export NODE_EXTRA_CA_CERTS=/tmp/extra-ca.crt; fi; \
    npm ci --no-audit --no-fund && rm -f /tmp/extra-ca.crt
COPY scripts ./scripts
RUN node scripts/build-monaco.mjs

FROM node:22-bookworm-slim
# The commit this is (the admin's Server page compares it with GitHub's newest)
ARG REVISION=""
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 BQ_REVISION=$REVISION
WORKDIR /app
COPY server ./server
COPY public ./public
# The quiz format and an example go into the AI prompt teachers can download.
COPY docs/quiz-format.md ./docs/quiz-format.md
COPY examples/ap-csa-unit4/quiz.json ./examples/ap-csa-unit4/quiz.json
COPY --from=editor /src/public/vendor ./public/vendor
RUN mkdir -p /data && chown node:node /data
# Starts as root only to make the data volume the app's, then runs the app as the node user.
ENTRYPOINT ["sh", "/app/server/entrypoint.sh"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.js"]
