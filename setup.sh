#!/usr/bin/env bash
# BrowserQuiz setup for Mac and Linux. Makes .env (asks for a teacher password and what students write code
# in, generates the other secrets), picks a free port, then downloads and starts everything.
# Safe to run again (it updates).
#   ./setup.sh              set up and start
#   ./setup.sh --languages  ask again what students write code in
#   ./setup.sh --build      build the images here instead of downloading them
#   ./setup.sh --no-build   start with the images already here
set -euo pipefail
cd "$(dirname "$0")"

get_images=pull
ask_langs=
for arg in "$@"; do
  case "$arg" in
    --build) get_images=build ;;
    --no-build) get_images= ;;
    --languages) ask_langs=1 ;;
  esac
done

rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-32}" || true; }
made_up_password() {
  local s
  s=$(LC_ALL=C tr -dc 'abcdefghjkmnpqrstuvwxyz23456789' </dev/urandom | head -c 12 || true)
  printf '%s-%s-%s' "${s:0:4}" "${s:4:4}" "${s:8:4}"
}

# ---------- asking ----------
# A question is "? Question", and once answered, a line "✔ What  answer". A check is ✔ when it's fine,
# ! when it's not but setup goes on, ✘ when setup can't. Colors only on a terminal.
B= D= C= G= Y= X= R=
if [ -t 1 ]; then
  B=$(tput bold 2>/dev/null || true); D=$(tput dim 2>/dev/null || true); R=$(tput sgr0 2>/dev/null || true)
  C=$(tput setaf 6 2>/dev/null || true); G=$(tput setaf 2 2>/dev/null || true)
  Y=$(tput setaf 3 2>/dev/null || true); X=$(tput setaf 1 2>/dev/null || true)
fi
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in *[Uu][Tt][Ff]-8* | *[Uu][Tt][Ff]8*) TICK='✔' CROSS='✘' PICK='❯' ;; *) TICK='+' CROSS='x' PICK='>' ;; esac
ask() { printf '%s?%s %s%s%s %s(%s)%s ' "$C" "$R" "$B" "$1" "$R" "$D" "$2" "$R"; }
answered() { printf '%s%s%s %s%-14s%s %s\n' "$G" "$TICK" "$R" "$B" "$1" "$R" "$2"; }
warn() { printf '%s!%s %s%-14s%s %s\n' "$Y" "$R" "$B" "$1" "$R" "$2"; }
fail() { printf '%s%s%s %s%-14s%s %s\n\n' "$X" "$CROSS" "$R" "$B" "$1" "$R" "$2"; exit 1; }
trap 'tput cnorm 2>/dev/null || true' EXIT
# choose "Question" "Label" "option 1" "option 2" ...: up and down arrows (or an option's number), then Enter.
# The question and its options are then replaced by its answered line. -> CHOICE (from 0)
choose() {
  local q=$1 label=$2 sel=0 key rest i
  shift 2
  local n=$#
  local opts=("$@")
  ask "$q" "↑↓ and Enter"; echo
  tput civis 2>/dev/null || true
  while :; do
    for ((i = 0; i < n; i++)); do
      if [ "$i" -eq "$sel" ]; then printf '\r\033[K%s%s %s%s\n' "$C" "$PICK" "${opts[i]}" "$R"
      else printf '\r\033[K  %s\n' "${opts[i]}"; fi
    done
    IFS= read -rsn1 key || break
    case "$key" in
      $'\033') IFS= read -rsn2 rest || true
        case "$rest" in
          '[A' | 'OA') [ "$sel" -gt 0 ] && sel=$((sel - 1)) ;;
          '[B' | 'OB') [ "$sel" -lt $((n - 1)) ] && sel=$((sel + 1)) ;;
        esac ;;
      '') break ;;
      [1-9]) [ "$key" -le "$n" ] && sel=$((key - 1)) ;;
    esac
    printf '\033[%dA' "$n"
  done
  tput cnorm 2>/dev/null || true
  printf '\033[%dA\r\033[J' "$((n + 1))"
  answered "$label" "${opts[sel]%%  *}"
  CHOICE=$sel
}

echo
echo "${B}BrowserQuiz setup${R}"
echo

# ---------- this computer ----------
echo "${B}Checking this computer${R}"
command -v docker >/dev/null || fail Docker "not installed: https://docs.docker.com/get-docker/"
docker info >/dev/null 2>&1 || fail Docker "not running: start it, then run this again"
compose=$(docker compose version --short 2>/dev/null || true)
[ -n "$compose" ] || fail Compose "not installed: https://docs.docker.com/compose/install/"
info() { docker info --format "$1" 2>/dev/null || true; }
answered Docker "$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?') (Compose ${compose#v})"
# The code sandbox needs Linux 5.13+ (Landlock) on a 64-bit processor; without them all but code questions works
arch=$(info '{{.Architecture}}')
case "$arch" in x86_64 | amd64) cpu="64-bit Intel/AMD" ;; aarch64 | arm64) cpu="64-bit ARM" ;; *) cpu= ;; esac
read -r kmaj kmin <<EOF2
$(info '{{.KernelVersion}}' | sed -n 's/^\([0-9]*\)\.\([0-9]*\).*/\1 \2/p')
EOF2
case "$(info '{{.OperatingSystem}}')" in *"Docker Desktop"*) system="Docker Desktop" ;; *) system="Linux ${kmaj:-?}.${kmin:-?}" ;; esac
if [ -n "${kmaj:-}" ] && { [ "$kmaj" -lt 5 ] || { [ "$kmaj" -eq 5 ] && [ "${kmin:-0}" -lt 13 ]; }; }; then
  warn System "$system: code questions need Linux 5.13+ (the rest works)"
elif [ -z "$cpu" ]; then
  warn System "$system, $arch: code questions need 64-bit (the rest works)"
else
  answered System "$system, $cpu"
fi
mem=$(info '{{.MemTotal}}')
if [ -n "$mem" ] && [ "$mem" -gt 0 ] 2>/dev/null; then
  gb=$(awk -v m="$mem" 'BEGIN { printf "%.1f", m / 1073741824 }')
  if [ "$mem" -lt 1900000000 ]; then warn Memory "$gb GB for Docker: tight for a class (2 GB+ is better)"
  else answered Memory "$gb GB for Docker"; fi
fi
# Free space where Docker keeps images: on a Linux server (Docker Desktop keeps them in its own VM)
root=$(info '{{.DockerRootDir}}')
avail=$([ -n "$root" ] && [ -d "$root" ] && df -Pk "$root" 2>/dev/null | awk 'NR == 2 { print $4 }' || true)
if [ -n "$avail" ]; then
  free=$(awk -v k="$avail" 'BEGIN { g = k / 1048576; printf (g < 10 ? "%.1f" : "%.0f"), g }')
  if [ "$avail" -lt 1572864 ]; then fail Disk "$free GB free: needs at least 1.5 GB"
  elif [ "$avail" -lt 4194304 ]; then warn Disk "$free GB free: not enough for all nine languages (4 GB)"
  else answered Disk "$free GB free"; fi
fi
# Can it download? (-k: a school network that inspects HTTPS mustn't look offline; only the status is used)
if [ -n "$get_images" ] && command -v curl >/dev/null; then
  reach() { [ "$(curl -ks -o /dev/null -m 6 -w '%{http_code}' "$1" 2>/dev/null || true)" != 000 ]; }
  if reach https://ghcr.io/v2/; then
    answered Internet "can reach GitHub"
  elif reach https://registry-1.docker.io/v2/; then
    warn Internet "can't reach GitHub: building here instead (10+ min)"
    get_images=build
  elif docker image inspect ghcr.io/areng14/browserquiz-app:latest >/dev/null 2>&1; then
    warn Internet "offline: starting the copy that's already here"
    get_images=
  else
    fail Internet "offline: BrowserQuiz has to download once (about 220 MB)"
  fi
fi
echo

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
  [ -n "$pw" ] && echo "The admin password in .env is too short."
  pw=
  if [ -t 0 ]; then
    ask "Admin password" "10+ characters, or Enter to make one up"; read -r -s pw; echo
    while [ -n "$pw" ] && [ ${#pw} -lt 10 ]; do
      ask "Admin password" "needs 10+ characters, or Enter to make one up"; read -r -s pw; echo
    done
  fi
  if [ -z "$pw" ]; then pw=$(made_up_password); new_password=$pw; fi
  put ADMIN_PASSWORD "$pw"
  [ -t 0 ] && printf '\033[%dA\r\033[J' 1 && answered "Admin password" "$([ -n "$new_password" ] && echo "made up (shown at the end)" || echo set)" && echo
fi
# Too short means the app never started with it, so no roster depends on it yet.
pepper=$(get ID_PEPPER)
[ ${#pepper} -ge 12 ] || put ID_PEPPER "$(rand 32)"
token=$(get RUNNER_TOKEN)
[ ${#token} -ge 16 ] || put RUNNER_TOKEN "$(rand 32)"
# What students write code in: the code runner's languages (RUNNER_LANGS). Asked the first time, and with
# --languages; without a terminal, the smaller one.
langs=$(get RUNNER_LANGS)
if [ -n "$ask_langs" ] || { [ "$langs" != standard ] && [ "$langs" != full ]; }; then
  langs=standard
  if [ -t 0 ]; then
    choose "What will students write code in?" "Languages" \
      "Java, Python, JavaScript, TypeScript" "All nine: also C, C++, C#, Go, Rust  ${D}(bigger download)${R}"
    [ "$CHOICE" = 1 ] && langs=full
    echo
  fi
  put RUNNER_LANGS "$langs"
fi

# ---------- port ----------
port=$(get APP_PORT)
if [ -z "$port" ]; then
  port=$(docker compose port app 8080 2>/dev/null | sed -n 's/.*://p' | head -n1 || true)  # already running: keep it
  if [ -z "$port" ]; then
    port=8080
    while (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; do port=$((port + 1)); done
    if [ "$port" != 8080 ]; then
      answered "Port" "$port  ${D}(8080 is taken)${R}"
      echo
      put APP_PORT "$port"
    fi
  fi
fi

# ---------- start ----------
# This computer's address on the network: the app shows it as where students join, instead of localhost
ip=$( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true) | awk '{print $1}')
export HOST_LAN_IP="$ip"
# the commit, for a build here (the Server page compares it with GitHub's newest)
BQ_REVISION=$(git rev-parse HEAD 2>/dev/null || true)
export BQ_REVISION
build=
if [ "$get_images" = pull ]; then
  echo "${B}Downloading BrowserQuiz...${R}"
  # A network that blocks the download: up builds what's missing here instead (10+ minutes the first time)
  docker compose pull --ignore-pull-failures app runner || echo "Couldn't download the images: building them here instead."
  echo
elif [ "$get_images" = build ]; then
  build=--build
fi
echo "${B}Starting BrowserQuiz...${R}"
docker compose up -d $build

printf 'Waiting for it to answer'
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

[ -n "$ip" ] || ip="<this computer's IP>"
echo
if [ -z "$up" ]; then
  printf '%s%s%s %sBrowserQuiz didn'"'"'t start.%s Here'"'"'s what it said:\n\n' "$X" "$CROSS" "$R" "$B" "$R"
  docker compose logs app --tail 15
  exit 1
fi
line() { printf '  %-12s %s\n' "$1" "$2"; }
echo "${G}${TICK}${R} ${B}BrowserQuiz is running${R}"
echo
line "Teacher" "http://localhost:$port/teacher"
line "Students" "http://$ip:$port"
running=$(docker compose exec -T app printenv BQ_REVISION 2>/dev/null | cut -c1-7 || true)
[ -n "$running" ] && line "Version" "$running"
[ -n "$new_password" ] && line "Password" "$new_password  ${D}(saved in .env)${R}"
line "Languages" "$([ "$(get RUNNER_LANGS)" = full ] && echo "all nine" || echo "Java, Python, JavaScript, TypeScript")  ${D}(change: ./setup.sh --languages)${R}"
if echo "$runner" | grep -q "sandbox ok"; then
  line "Code runner" "OK"
else
  line "Code runner" "not running, so code questions can't run or be graded:"
  echo "$runner" | grep '^  - ' | sort -u | sed 's/^/  /'
fi
