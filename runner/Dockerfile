# BrowserQuiz code runner, inside the jail-lite sandbox. Two kinds, by RUNNER_LANGS:
#   standard (the default): Java 21, Python 3 and Node 22 (JavaScript and TypeScript). About 200 MB to download.
#   full: those, and gcc and g++ (C and C++), .NET 10 (C#), Go and Rust. About 800 MB to download.
#   docker build --build-arg RUNNER_LANGS=full -t browserquiz-runner runner
# (Railway passes a service variable of the same name.) It runs as root inside the container only so it
# can drop each job to its own uid.
FROM node:22-bookworm-slim AS node
# Java with only the modules javac and students' code use (all of java.se, so java.util, java.awt.Point and the
# rest), and a class data archive of its own: half the JDK's size, and javac starts faster.
FROM eclipse-temurin:21-jdk AS jdk
RUN jlink --add-modules java.se,jdk.compiler,jdk.unsupported,jdk.zipfs --strip-debug --no-man-pages --no-header-files \
      --generate-cds-archive --output /jdk
FROM ubuntu:26.04
COPY --from=jdk /jdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk PATH=/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ARG RUNNER_LANGS=standard
# Only behind a TLS-intercepting proxy: its CA certificate (public), as in server/Dockerfile.
#   docker build --build-arg EXTRA_CA="$(cat /path/to/ca.crt)" -t browserquiz-runner runner
ARG EXTRA_CA=""
RUN case "$RUNNER_LANGS" in standard|full) ;; *) echo "RUNNER_LANGS is standard or full, not \"$RUNNER_LANGS\""; exit 1 ;; esac; \
    if [ -n "$EXTRA_CA" ]; then printf '%s\n' "$EXTRA_CA" > /tmp/extra-ca.crt; echo 'Acquire::https::CaInfo "/tmp/extra-ca.crt";' > /etc/apt/apt.conf.d/99ca; fi; \
    apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 \
      $(if [ "$RUNNER_LANGS" = full ]; then echo gcc g++ libc6-dev golang-go rustc dotnet-sdk-10.0; fi) \
 && rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99ca /tmp/extra-ca.crt
COPY --from=node /usr/local/bin/node /usr/local/bin/node
# The rest is the full runner's.
# The C++ prelude, precompiled with the same flags runner.py compiles with, so a compile is fast.
COPY bqpre.hpp /opt/bq/cpp/bqpre.hpp
RUN if [ "$RUNNER_LANGS" = full ]; then \
      g++ -std=gnu++17 -O2 -D_GLIBCXX_ASSERTIONS -w -fno-inline -fno-builtin -fno-tree-loop-distribute-patterns -fno-ipa-icf -fno-ipa-cp \
        -ffunction-sections -x c++-header /opt/bq/cpp/bqpre.hpp -o /opt/bq/cpp/bqpre.hpp.gch; fi
# Go's standard library, compiled once: jobs compile and link against it (go tool compile/link with this
# importcfg) instead of running "go build", which would rebuild it into a cache every time.
# bqscan: the ban check's facts for Go (go/types over the student's files).
COPY bqscan.go /opt/bq/go/src/bqscan.go
RUN if [ "$RUNNER_LANGS" = full ]; then \
      mkdir -p /opt/bq/go && GOCACHE=/opt/bq/go/cache go list -export -f '{{if .Export}}packagefile {{.ImportPath}}={{.Export}}{{end}}' std > /opt/bq/go/importcfg \
   && ln -s "$(go env GOTOOLDIR)" /opt/bq/go/tool \
   && cd /opt/bq/go/src && GOCACHE=/tmp/gobuild GO111MODULE=off go build -o /opt/bq/go/bqscan bqscan.go && rm -rf /tmp/gobuild \
   && chmod -R a+rX /opt/bq/go; fi
# C#: the compiler run directly (no MSBuild, which takes seconds), against the framework's reference assemblies.
# bqscan: the ban check's facts for C# (the compiled code's member and type references).
COPY bqscan.cs /opt/bq/cs/src/bqscan.cs
RUN if [ "$RUNNER_LANGS" = full ]; then \
      ln -s "$(ls -d /usr/lib/dotnet/sdk/*/Roslyn/bincore/csc.dll | head -1)" /opt/bq/cs/csc.dll \
   && for f in $(ls -d /usr/lib/dotnet/packs/Microsoft.NETCore.App.Ref/*/ref/net*/ | head -1)*.dll; do echo "-r:$f"; done > /opt/bq/cs/refs.rsp \
   && printf '{ "runtimeOptions": { "tfm": "net10.0", "framework": { "name": "Microsoft.NETCore.App", "version": "%s" } } }\n' \
        "$(ls /usr/lib/dotnet/shared/Microsoft.NETCore.App/ | head -1)" > /opt/bq/cs/main.runtimeconfig.json \
   && DOTNET_CLI_TELEMETRY_OPTOUT=1 dotnet exec /opt/bq/cs/csc.dll -nologo -noconfig -nostdlib @/opt/bq/cs/refs.rsp -langversion:latest -nullable:enable \
        -optimize+ -target:exe -out:/opt/bq/cs/bqscan.dll /opt/bq/cs/src/bqscan.cs && chmod -R a+rX /opt/bq/cs; fi
COPY runner.py /runner/runner.py
ENV JOBS_DIR=/jobs PORT=8080 PYTHONDONTWRITEBYTECODE=1 RUNNER_LANGS=$RUNNER_LANGS
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=4)"
CMD ["python3", "-u", "/runner/runner.py"]
