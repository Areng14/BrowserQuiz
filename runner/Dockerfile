# BrowserQuiz code runner: Java 21, Python 3, Node 22 (JavaScript and TypeScript), gcc and g++ (C and C++),
# .NET 10 (C#), Go, Rust, Swift and Ruby, inside the jail-lite sandbox. It runs as root inside the container only so it can drop each job to its own uid.
FROM node:22-bookworm-slim AS node
FROM eclipse-temurin:21-jdk
# Only behind a TLS-intercepting proxy: its CA certificate (public), as in server/Dockerfile.
#   docker build --build-arg EXTRA_CA="$(cat /path/to/ca.crt)" -t browserquiz-runner runner
ARG EXTRA_CA=""
RUN if [ -n "$EXTRA_CA" ]; then printf '%s\n' "$EXTRA_CA" > /tmp/extra-ca.crt; echo 'Acquire::https::CaInfo "/tmp/extra-ca.crt";' > /etc/apt/apt.conf.d/99ca; fi; \
    apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 gcc g++ libc6-dev golang-go rustc \
      dotnet-sdk-10.0 swiftlang ruby \
 && rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99ca /tmp/extra-ca.crt \
 # Swift without its debugger, language server, package manager and embedded targets: 2.4 GB -> 1 GB
 && cd /usr/libexec/swift && rm -rf bin/lldb* bin/clangd bin/sourcekit-lsp bin/docc bin/swift-format bin/swift-package* bin/swift-build* \
      bin/swift-test bin/swift-run bin/swift-sdk bin/swift-experimental-sdk bin/repl_swift bin/llvm-profdata bin/llvm-cov bin/swift-api-* \
      bin/swift-symbolgraph-extract bin/swift-synthesize-interface bin/plutil bin/wasm-ld bin/lld-link bin/ld64.lld bin/clang-cl \
      bin/swift-cache-tool bin/swift-help bin/*legacy-driver bin/swift-plugin-server lib/liblldb* lib/libsourcekitdInProc* \
      lib/swift_static lib/libIndexStore* lib/swift/embedded lib/swift/FrameworkABIBaseline share
COPY --from=node /usr/local/bin/node /usr/local/bin/node
# The C++ prelude, precompiled with the same flags runner.py compiles with, so a compile is fast.
COPY bqpre.hpp /opt/bq/cpp/bqpre.hpp
RUN g++ -std=gnu++17 -O2 -D_GLIBCXX_ASSERTIONS -w -x c++-header /opt/bq/cpp/bqpre.hpp -o /opt/bq/cpp/bqpre.hpp.gch
# Go's standard library, compiled once: jobs compile and link against it (go tool compile/link with this
# importcfg) instead of running "go build", which would rebuild it into a cache every time.
RUN mkdir -p /opt/bq/go && GOCACHE=/opt/bq/go/cache go list -export -f '{{if .Export}}packagefile {{.ImportPath}}={{.Export}}{{end}}' std > /opt/bq/go/importcfg \
 && ln -s "$(go env GOTOOLDIR)" /opt/bq/go/tool && chmod -R a+rX /opt/bq/go
# C#: the compiler run directly (no MSBuild, which takes seconds), against the framework's reference assemblies.
RUN mkdir -p /opt/bq/cs && ln -s "$(ls -d /usr/lib/dotnet/sdk/*/Roslyn/bincore/csc.dll | head -1)" /opt/bq/cs/csc.dll \
 && for f in $(ls -d /usr/lib/dotnet/packs/Microsoft.NETCore.App.Ref/*/ref/net*/ | head -1)*.dll; do echo "-r:$f"; done > /opt/bq/cs/refs.rsp \
 && printf '{ "runtimeOptions": { "tfm": "net10.0", "framework": { "name": "Microsoft.NETCore.App", "version": "%s" } } }\n' \
      "$(ls /usr/lib/dotnet/shared/Microsoft.NETCore.App/ | head -1)" > /opt/bq/cs/main.runtimeconfig.json && chmod -R a+rX /opt/bq/cs
COPY runner.py /runner/runner.py
ENV JOBS_DIR=/jobs PORT=8080 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=4)"
CMD ["python3", "-u", "/runner/runner.py"]
