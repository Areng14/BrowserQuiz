# BrowserQuiz app: student app, teacher dashboard and API. Build from the repo root:
#   docker build -f server/Dockerfile -t browserquiz-app .
FROM node:22-bookworm-slim AS editor
WORKDIR /src
COPY package.json package-lock.json ./
# extra_ca is optional: only needed behind a TLS-intercepting proxy.
#   docker build --secret id=extra_ca,src=/path/to/ca.crt ...
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --no-audit --no-fund
COPY scripts ./scripts
RUN node scripts/build-monaco.mjs

FROM node:22-bookworm-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
WORKDIR /app
COPY server ./server
COPY public ./public
# The quiz format and an example go into the AI prompt teachers can download.
COPY docs/quiz-format.md ./docs/quiz-format.md
COPY examples/ap-csa-unit4/quiz.json ./examples/ap-csa-unit4/quiz.json
COPY --from=editor /src/public/vendor ./public/vendor
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.js"]
