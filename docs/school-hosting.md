# Hosting it at school

How to run BrowserQuiz for free on a computer the school already has. Give this page to whoever looks
after the school's servers. The full reference is [setup.md](setup.md).

## What it needs

- One computer that's on whenever there's a class: a spare PC, a server, or a virtual machine. Linux
  (Ubuntu 22.04 or newer, or Debian 12) is best. Windows 10 or 11 with Docker Desktop works too.
- 2 CPU cores and 4 GB of RAM for a class of about 30. It runs on 2 GB, but code questions are slower.
- About 15 GB of free disk. The code runner holds Java, Python, JavaScript, C and C++, C#, Go and Rust.
- Internet only to install and update. During a quiz, the students' devices just have to reach it.

## Install

1. Install Docker. On Linux: `curl -fsSL https://get.docker.com | sh`. On Windows: Docker Desktop.
2. Get BrowserQuiz and run the setup script:

   ```bash
   git clone https://github.com/Areng14/BrowserQuiz.git && cd BrowserQuiz
   ./setup.sh
   ```

   On Windows, double-click `setup.cmd` instead.
3. The script prints the address. Open it from a classroom computer, and sign in at `/teacher` as
   `admin` with the password the script showed.

It comes back on its own after a reboot. On Linux, Docker starts at boot. On Windows, turn on **Start
Docker Desktop when you sign in to your computer**; someone has to sign in to that PC after a restart.

## The network

- Give the computer a fixed address (a DHCP reservation), so the address students type never changes.
- Open the port the script printed in the firewall (8080 unless something else had it), or 443 with
  HTTPS (below).
- Only devices on the school network can reach it. That's fine for exams. For practice quizzes from
  home it has to be reachable from the internet; that's the school's call.

## HTTPS

Plain HTTP on the school network is fine for trying it out. Before real exams, set up HTTPS:
passwords and student IDs are encrypted on the way, passkeys work, and exam mode can do more.

Pick whichever of these the school can do:

- **The school's own certificate.** Many schools have one, or a certificate authority their devices
  already trust. Put `cert.pem` and `key.pem` in a `certs` folder next to `docker-compose.yml`. Add
  `- ./certs:/certs:ro` under the `caddy` service's `volumes`, and change `Caddyfile` to:

  ```
  {$DOMAIN} {
  	encode gzip
  	tls /certs/cert.pem /certs/key.pem
  	reverse_proxy app:8080
  }
  ```

- **A public domain.** Point the domain at the school's public address and open ports 80 and 443 from
  the internet to this computer. Caddy then gets a free certificate by itself.
- **No open ports.** A Cloudflare Tunnel (free, if the domain's DNS is on Cloudflare) gives it an HTTPS
  address without opening the firewall. Point the tunnel at `http://localhost:8080`, and skip the
  `docker compose` command below.

For the first two, set these in `.env`, then start it with HTTPS:

```
DOMAIN=quiz.yourschool.org
APP_BIND=127.0.0.1
TRUST_PROXY=1
```

```bash
docker compose --profile https up -d --build
```

With a tunnel, set `APP_BIND=127.0.0.1` and `TRUST_PROXY=1` too, then run `docker compose up -d`.
Leave `DOMAIN` empty.

## Keep it safe

- Back up the data between terms. The command is under [Day to day](setup.md#day-to-day).
- Keep a copy of `.env` somewhere safe. Without its `ID_PEPPER`, no student can sign in again.
- To update: `git pull && docker compose up -d --build`, when no quiz is running.

## Moving over from Railway

Before switching, download each quiz (its **⋯** menu on the Quizzes tab, then **Download**), and use
**Export CSV** on each past quiz you want to keep scores for. On the new server, upload the quizzes and
the class CSVs again.

## If the school says no

Oracle Cloud's Always Free tier includes a virtual machine with up to 4 cores and 24 GB of RAM, and it
doesn't cost anything. Sign-up asks for a card to check who you are, but Always Free resources aren't
charged.

1. Create an instance with the Ubuntu image and an Ampere (ARM) shape. If it says it's out of
   capacity, try another availability domain, or try again later.
2. In its virtual cloud network's security list, allow ports 80 and 443 from anywhere.
3. Point a domain at its public address. A free DuckDNS name works.
4. Follow **Install** above, then **A public domain** under HTTPS.

Oracle's Ubuntu images come with a strict firewall of their own. If the site still doesn't load, that's
the next place to look.
