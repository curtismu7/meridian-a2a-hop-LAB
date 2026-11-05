# Meridian Pay A2A LAB

Tier: Demo

Repo: https://github.com/curtismu7/meridian-a2a-hop-LAB

Walk a delegated agent token chain **one hop at a time**: sign in, hand the job to an
external agent, exchange tokens (RFC 8693), and call MCP tools through Privilege doors.
Every hop shows the token it carried - `sub`, `act`, `aud`, `scope` - and what the next
exchange changed. Refusals are part of the demo: each step lists the wrong way to call
and what the platform answers.

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
Ports: meridian-a2a-hop-LAB listens on 6600 (set with PORT, default 6600).
Port range for this app: 6600-6649.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:6600 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, stop it, or start this app on another port:
   PORT=<other port> npm start
```

Other variable: `HOST_PORT=6600` (Docker host port). Keep both inside 6600-6649.

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
npm start          # http://127.0.0.1:6600  (mock mode; nothing else to set up)
```

Docker (OrbStack): `docker compose up --build -d` - publishes `127.0.0.1:6600` only.

## Docs

- `docs/talk-track.md` - the demo story, hop by hop, plus the external-agent / third-party section
- `docs/architecture.md` - components, ports, trust domains
- `content-pack.json` - Learning Hub glossary

## Rules this follows

`~/Development/STANDALONE-RULES.md` (Demo tier): mock mode fully offline with an honest
banner, tokens shown raw, secrets write-only server-side, loopback-only bind, Node 26,
GitHub-hosted CI, no cross-repo imports.
