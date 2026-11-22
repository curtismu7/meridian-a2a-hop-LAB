# Meridian Pay A2A LAB

Tier: Demo

Repo: https://github.com/curtismu7/meridian-a2a-hop-LAB

Walk a delegated agent token chain **one hop at a time**: sign in, hand the job to an
external agent, exchange tokens (RFC 8693), and call MCP tools through Privilege doors.
Every hop shows the token it carried - `sub`, `act`, `aud`, `scope` - and what the next
exchange changed. Refusals are part of the demo: each step lists the wrong way to call
and what the platform answers. The door hop also shows **What Privilege did** (rule 25): the exact
request, the exact response, and the decisions between them (the simulated door's checks in mock; a
real gateway's answer marked inferred in real).

Fictional brand: **Meridian Pay**, a payouts platform. Person **Jordan Ellis** asks a
concierge agent about payouts; specialists (`meridian-payouts`, `meridian-payments`)
do the work; a platform-signed external agent acts for Jordan.

> **Demo sign-in:** real mode signs in with the user configured in `MERIDIAN_USER_USERNAME`
> (default setup: the demo user seeded by the owner kit; password in the shared settings file). The
> sign-in form pre-fills it. Mock mode needs no credentials. See `docs/live-identity.md`.

## Run from a clone

Prerequisites: Node 26. Docker (OrbStack) only for the Docker form.

```
git clone https://github.com/curtismu7/meridian-a2a-hop-LAB.git
cd meridian-a2a-hop-LAB
npm ci
npm run build
npm run doctor
npm start
```

## Ports, and what to do if the port is taken

```
Ports: meridian-a2a-hop-LAB listens on 7720 (set with PORT, default 7720).
Port range for this app: 7720-7729.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:7720 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, stop it, or start this app on another port:
   PORT=<other port> npm start
```

Other variable: `HOST_PORT=7720` (Docker host port). Keep both inside 7720-7729.

## Status

- [x] Planned (source: walkthrough video of the AgentIAMCore "w-pay A2A, one hop at a time" demo, rebuilt on PingOne + PingOne Privilege)
- [x] Phase 0 scaffold (UI shell, stepper, diagram, Docker, conformance 0 failed)
- [x] Phase 1 mock mode (fully offline, stub issuer with third-party trusted-issuer registry, mock Privilege doors, refusal matrix)
- [x] Phase 2 real mode (PingOne pi.flow sign-in, measured third-party token exchange, Privilege gateway doors) — both doors live on the SE gateway (host recorded in the owner notes; paths `meridian-{payouts,payments}/mcp`), policies grant the demo user, and the refusal matrix was verified live (200 allowed / 403 wrong tool / 401 wrong door). See `docs/live-identity.md`
- [ ] v1.1: A2A chat tail (agent card, chat, compliance badges)

## Run

```sh
npm install
npm run build
npm start          # http://127.0.0.1:7720  (mock mode; nothing else to set up)
```

Docker (OrbStack): `docker compose up --build -d` - publishes `127.0.0.1:7720` only.

## What a run leaves behind: observability (rule 27)

Under the Run result the page shows **"What each layer logged for this run"** (the shared panel, vendored byte for byte in
`web/src/run-observability/` and `server/src/runObservability.js`, pinned by `run-observability.sha256`): person, agent, Authorize,
Privilege, agent gateway and resource server, in time order, each row with its time and an honest tag. `GET /api/run-observability`
builds it for the current run in the current mode (`204` before a run, `{error, message}` JSON on a failure).

- **Mock**: every row is `simulated`, computed from what the mock did on this run (the mock issuer's answers, the simulated door's
  seven checks, the payouts backend's answer). Nothing is shown as read from a log.
- **Real** (owner-run, needs PingOne and a door): `response` rows for the replies the lab received (PingOne's sign-in and exchange
  answers, the door's HTTP status; never tagged `logged`), plus `logged` rows read from Elasticsearch with a read-only key.
  Without `RUN_OBS_ES_URL` and `RUN_OBS_ES_READ_APIKEY` the log layers say `unreachable` and what to set; the lab keeps working.
- **The lab's own log**: each decision this lab's server makes (sign-in, each token exchange, the door verdict, the backend answer)
  is one stdout line, `[time] INFO: meridian-a2a-hop decision <what> actor=<who> result=<passed|rejected|unclear|no-reply> mode=<mock|real>`,
  never a token. INFO for everything except a real error (a door 5xx or no reply: WARN). Claim values are reduced to safe characters so a
  claim cannot add a fake `key=value` pair.
- **Real, late lines**: a collector ships lines with a delay, so the hop just run can read `not logged` at first. In Real the page shows a
  **Re-read logs** button and reads once more about 5 seconds after each hop (Mock needs neither).

Where the logs live and where they can stream:

| Product | Lives in | Streams to |
|---|---|---|
| This lab (server) | container stdout, one line per decision | a collector to `demo-logs-<service>`, then a SIEM |
| PingOne (sign-in, token exchange) | the PingOne audit activity API (SaaS) | not shipped or read here yet |
| Privilege agent gateway (local) | `cyonproxy.log` in its log volume | the collector's file source to `ping-logs-privilege-gateway` |
| Privilege hosted gateway and console | SIEM index `ping-siem-events-v2`, console Activity Logs | the Privilege SIEM export |
| Payouts MCP backend | Mock: an in-process stub, no log. Real: the MCP server container stdout | the collector to `demo-logs-<service>` |

**Not logged today (the panel says so, it never claims a line):** PingOne Authorize (this lab does not call it, and Authorize has
no container log); PingOne sign-in and token exchange (audit API not read); PingFederate `audit.log` (not shipped; this lab uses
PingOne); gateway refusal and block lines (the shape is unconfirmed, a rejected call left no line on the local gateway); Mock has no
separate Privilege policy / AI Guard / approval event, so that layer is `not-logged` in Mock. **UNVERIFIED:** the MCP server's served and refused line wording, so a `logged` resource row carries the `UNVERIFIED shape` tag.
**The lab's own stdout lines are not read back by the page:** no shared matcher recognises them, and they are worded (`result=rejected`,
never refused, denied, token, audience, scope or served) so the shared MCP-server matchers, which read any `[time] INFO|WARN:` line,
cannot turn one into a `logged` row on the wrong layer. They exist for a collector and a SIEM, not for the Real `logged` rows, which
come only from the products' own logs.

Environment (both empty by default, in `.env.example` and passed through `docker-compose.yml`): `RUN_OBS_ES_URL` (a loopback
Elasticsearch origin) and `RUN_OBS_ES_READ_APIKEY` (a read-only key; never returned, logged or put in an error). The compose file
does **not** mount the Docker socket; the Docker reader (`RUN_OBS_DOCKER=1`) is for a throwaway ad-hoc override only. The "zero real outbound calls" claim has one named exception: the vendored shared
Elasticsearch reader, which reads that loopback URL with its own fetch, in Real mode only and never in Mock.

## Docs

- `docs/talk-track.md` - the demo story, hop by hop, plus the external-agent / third-party section
- `docs/architecture.md` - components, ports, trust domains
- `content-pack.json` - Learning Hub glossary

## Rules this follows

`~/Development/STANDALONE-RULES.md` (Demo tier): mock mode fully offline with an honest
banner, tokens shown raw, secrets write-only server-side, loopback-only bind, Node 26,
GitHub-hosted CI, no cross-repo imports.

---

## Real mode: through the PingOne Privilege gateway

**Privilege objects this lab uses:** the gateway doors `meridian-payments/mcp` and `meridian-payouts/mcp` (`MERIDIAN_MCP_DOOR_*`), walked one delegated-token hop at a time

Settings keys: `MERIDIAN_GW_URL`, `MERIDIAN_GW_APPS`, at least one `MERIDIAN_GW_KEY_<NAME>`
in the shared settings file (`~/Development/.env`, or the file `STANDALONE_ENV` names). The key
is write-only: it is scrubbed from every message, error and log line.
