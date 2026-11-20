# BrowserQuiz code runner: Java 21 + Python 3 inside the jail-lite sandbox.
# It runs as root inside the container only so it can drop each job to its own uid.
FROM eclipse-temurin:21-jdk
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then echo "Acquire::https::CaInfo \"/run/secrets/extra_ca\";" > /etc/apt/apt.conf.d/99ca; fi; \
    apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99ca
COPY runner.py /runner/runner.py
ENV JOBS_DIR=/jobs PORT=8080 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=4)"
CMD ["python3", "-u", "/runner/runner.py"]
