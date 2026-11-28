# Hosting it on a school server

BrowserQuiz runs free on one server on your school's own network. For anything not covered here, see [setup.md](setup.md).

## Requirements

- **A Linux server or VM:** Ubuntu 22.04 or newer, or Debian 12, with Docker (Quick Install sets it up).
- **Size:** 2 CPU cores, 4 GB of RAM and about 15 GB of disk. That's enough for several classes at once: the app itself keeps up with a couple of thousand students. Grading code questions is what takes longer with more classes. If several classes write code at the same time, 4 to 8 cores grade it sooner ([runner slots](setup.md#languages)).
- **Up during school hours.** Keep the server on during school hours, when exams run. After a restart, each teacher has to sign in again before their quizzes work.
- **Internet only to install and update.** During a quiz it only talks to the students' devices and the teacher's browser. If a teacher adds an AI grading key, it also calls that AI provider. The student code runner runs in a separate box with no internet.

## Quick Install

1. Install Docker: `curl -fsSL https://get.docker.com | sh`
2. Get BrowserQuiz and run the setup script:

   ```bash
   git clone https://github.com/Areng14/BrowserQuiz.git && cd BrowserQuiz
   ./setup.sh
   ```
3. Answer its questions: the admin password (or press Enter to have it make one up) and what students write code in. It checks the server, writes the secrets to `.env`, downloads everything and prints the address.
4. Sign in at `/teacher` as `admin` and pick your own username and password. Add the other teachers from **Teachers**, in the menu under your name.

It starts again on its own after a reboot: Docker starts at boot, and the containers restart with it.

## Network setup

- **A fixed address.** Give the server a static IP or a DHCP reservation. Safe Exam Browser quizzes have the server's address written into them when they start, so it cannot change.
- **A name** in your DNS, like `browserquiz.school.example`, so students type a name instead of an IP.
- **The firewall.** Let students' devices reach ports 80 and 443 with HTTPS, or the port the setup script printed without it. The default is 8080.
- **School network only** is the default, and fine for exams. Practice quizzes from home need it reachable from the internet. That's up to you.
- The teacher's **Only students on my current network** option accepts any private (10.x / 192.168.x) address on a server like this.

## HTTPS

HTTPS isn't required, but it's recommended. Without it, browsers don't let the site check the monitor count or block `ALT + TAB` or `WIN`, so exam mode is weaker. HTTPS also adds TLS encryption and makes passkeys work.

Pick whichever you can do:

- **Your own certificate.** Many schools have a certificate authority their devices already trust.
  1. Get a certificate for the server's name (like `browserquiz.school.example`).
  2. Put `cert.pem` and `key.pem` in a `certs` folder next to `docker-compose.yml`. If you got a `.pfx` file instead, run these in that folder. Each one asks for the `.pfx` password. If one says `unsupported`, add `-legacy` to it.

     ```bash
     openssl pkcs12 -in cert.pfx -clcerts -nokeys -out cert.pem
     openssl pkcs12 -in cert.pfx -cacerts -nokeys >> cert.pem
     openssl pkcs12 -in cert.pfx -nocerts -nodes -out key.pem
     ```
  3. Add `- ./certs:/certs:ro` under the `caddy` service's `volumes`.
  4. Change `Caddyfile` to:

     ```
     {$DOMAIN} {
     	encode gzip
     	tls /certs/cert.pem /certs/key.pem
     	reverse_proxy app:8080
     }
     ```
- **A public domain.** Point it at your public address, and forward ports 80 and 443 from the internet to the server. Caddy then gets a free certificate by itself and renews it.

Either way, set these in `.env`:

```
DOMAIN=browserquiz.school.example
APP_BIND=127.0.0.1
TRUST_PROXY=1
```

Then start it with HTTPS:

```bash
docker compose --profile https up -d
```

### Certificate example

The server is `browserquiz.school.example`, and your certificate authority gave you a certificate for that name. The folder ends up like this:

```
BrowserQuiz/
  docker-compose.yml
  Caddyfile
  .env
  certs/
    cert.pem   <- the certificate, then any intermediate certificates under it
    key.pem    <- its private key
```

The `caddy` service in `docker-compose.yml`, with the new line at the end:

```yaml
  caddy:
    image: caddy:2
    profiles: [https]
    ...
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - ./certs:/certs:ro
```

Got a `.pfx` file instead (common from Windows servers)? Split it into the two files:

```bash
openssl pkcs12 -in browserquiz.pfx -clcerts -nokeys -out certs/cert.pem
openssl pkcs12 -in browserquiz.pfx -nocerts -nodes -out certs/key.pem
```

If `openssl` says `unsupported`, it's an older kind of `.pfx`. Add `-legacy` to both commands.

### Public domain example

Your domain is `quiz.yourschool.org`, your public IP is `203.0.113.10`, and the server is `10.0.5.20` on your network.

| Where | What |
| --- | --- |
| DNS | An `A` record: `quiz.yourschool.org` → `203.0.113.10` |
| Router or firewall | Forward TCP 80 and 443 to `10.0.5.20` |
| `.env` | `DOMAIN=quiz.yourschool.org`, `APP_BIND=127.0.0.1`, `TRUST_PROXY=1` |

Leave the `Caddyfile` as it comes. The first start takes a minute while Caddy gets the certificate.

### Checking that HTTPS works

```bash
curl -I https://browserquiz.school.example/healthz
```

An `HTTP/2 200` means it's up. If it isn't, `docker compose logs caddy` says why (a wrong file path, or a certificate for another name).

## Safe Exam Browser

Optional, for locked-down exams. SEB has to be installed on the student devices, which needs an administrator. BrowserQuiz makes the SEB settings for each quiz itself. Students click **Open Safe Exam Browser**, SEB downloads the quiz's `.seb` file from your server, and opens the quiz.

- **Open the dashboard at the server's name** (`https://browserquiz.school.example/teacher`). That's the address each SEB quiz is sent to.
- **Let SEB open exam links.** If your SEB is locked to one exam system (a client config for Moodle, say), turn on downloading and opening SEB config files (`downloadAndOpenSebConfig`). Otherwise the link does nothing and students cannot take the BrowserQuiz SEB exam.
- A student stuck in SEB can quit with the quit password on the quiz's live page.

## Updates, backups and logs

| Task | How |
| --- | --- |
| Update | `git pull && docker compose pull && docker compose --profile https up -d`, when no quiz is running |
| Logs | `docker compose logs -f app` |
| Back up and restore | On the Server page, in the menu under the admin's name ([more](setup.md#updates-backups-and-logs)) |

- Everything lives in one SQLite database in the `bq-data` volume. It backs itself up every night and keeps the last 7 there. Download one between terms, or let your VM backups cover it.
- Keep a copy of `.env` somewhere safe. Without its `ID_PEPPER`, no student can sign in again.
- Quizzes and student data are encrypted with each teacher's key, so a backup doesn't expose them.

## Test the setup

1. Sign in at `/teacher` as admin. Add a class with one test student, and a one-question quiz.
2. Start the quiz. If you set up Safe Exam Browser, start it as a Safe Exam Browser quiz.
3. On a student device, on the network students will use, open the address, join with the code, answer, and turn it in.
4. On the live page the test student shows as turned in. Close the quiz, and their score shows up.

If that works, the server, the network, HTTPS and SEB all work.
