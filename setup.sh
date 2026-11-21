#!/usr/bin/env bash
# BrowserQuiz setup for Mac and Linux. Makes .env (asks for a teacher password, generates the
# other secrets), picks a free port, then builds and starts everything. Safe to run again.
#   ./setup.sh             set up and start
#   ./setup.sh --no-build  start without rebuilding the images
set -euo pipefail
cd "$(dirname "$0")"

build=--build
[ "${1:-}" = "--no-build" ] && build=

rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-32}" || true; }
made_up_password() {
  local s
  s=$(LC_ALL=C tr -dc 'abcdefghjkmnpqrstuvwxyz23456789' </dev/urandom | head -c 12 || true)
  printf '%s-%s-%s' "${s:0:4}" "${s:4:4}" "${s:8:4}"
}

command -v docker >/dev/null || { echo "Docker isn't installed: https://docs.docker.com/get-docker/"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker isn't running. Start it, then run this again."; exit 1; }

# ---------- .env ----------
touch .env
chmod 600 .env
# Notepad saves Windows line endings; make them plain so values don't end in a stray \r.
if grep -q $'\r' .env; then tr -d '\r' < .env > .env.tmp && cat .env.tmp > .env && rm -f .env.tmp; fi
[ -s .env ] && [ -n "$(tail -c1 .env)" ] && echo >> .env
get() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- || true; }
put() {
  if grep -qE "^$1=" .env; then
    local tmp
    tmp=$(mktemp)
    K="$1" V="$2" awk 'index($0, ENVIRON["K"] "=") == 1 { print ENVIRON["K"] "=" ENVIRON["V"]; next } { print }' .env > "$tmp"
    cat "$tmp" > .env
    rm -f "$tmp"
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

new_password=
pw=$(get ADMIN_PASSWORD)
if [ ${#pw} -lt 10 ]; then
  [ -n "$pw" ] && echo "The teacher password in .env is too short."
  pw=
  if [ -t 0 ]; then
    read -r -s -p "Teacher password (10+ characters, Enter to make one up): " pw; echo
    while [ -n "$pw" ] && [ ${#pw} -lt 10 ]; do
      read -r -s -p "Needs 10+ characters. Try again (Enter to make one up): " pw; echo
    done
  fi
  if [ -z "$pw" ]; then pw=$(made_up_password); new_password=$pw; fi
  put ADMIN_PASSWORD "$pw"
fi
# Too short means the app never started with it, so no roster depends on it yet.
pepper=$(get ID_PEPPER)
[ ${#pepper} -ge 12 ] || put ID_PEPPER "$(rand 32)"
token=$(get RUNNER_TOKEN)
[ ${#token} -ge 16 ] || put RUNNER_TOKEN "$(rand 32)"

# ---------- port ----------
port=$(get APP_PORT)
if [ -z "$port" ]; then
  port=$(docker compose port app 8080 2>/dev/null | sed -n 's/.*://p' | head -n1 || true)  # already running: keep it
  if [ -z "$port" ]; then
    port=8080
    while (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; do port=$((port + 1)); done
    if [ "$port" != 8080 ]; then
      echo "Port 8080 is taken, using $port."
      put APP_PORT "$port"
    fi
  fi
fi

# ---------- start ----------
docker compose up -d $build

printf 'Waiting for BrowserQuiz to start'
up=
command -v curl >/dev/null || up=1  # can't check without curl
for _ in $(seq 1 60); do
  [ -n "$up" ] && break
  if curl -fs "http://localhost:$port/healthz" >/dev/null 2>&1; then up=1; break; fi
  printf '.'
  sleep 1
done
echo
sleep 2
runner=$(docker compose logs runner --tail 30 --no-log-prefix 2>/dev/null || true)

ip=$( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true) | awk '{print $1}')
[ -n "$ip" ] || ip="<this computer's IP>"
echo
if [ -z "$up" ]; then
  echo "BrowserQuiz didn't come up. Here's what it said:"
  docker compose logs app --tail 15
  exit 1
fi
echo "BrowserQuiz is running."
echo "  Teacher:  http://localhost:$port/teacher"
echo "  Students: http://$ip:$port"
[ -n "$new_password" ] && echo "  Password: $new_password  (saved in .env)"
if echo "$runner" | grep -q "sandbox ok"; then
  echo "  Code runner: OK"
else
  echo "  Code runner: not running, so code questions can't run or be graded:"
  echo "$runner" | grep '^  - ' | sort -u | sed 's/^/  /'
fi
