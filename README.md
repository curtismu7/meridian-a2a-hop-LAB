# Meridian Pay A2A, one hop at a time (LAB)

Tier: Demo

Walk a delegated agent token chain **one hop at a time**: sign in, hand the job to an
external agent, exchange tokens (RFC 8693), and call MCP tools through Privilege doors.
Every hop shows the token it carried - `sub`, `act`, `aud`, `scope` - and what the next
exchange changed. Refusals are part of the demo: each step lists the wrong way to call
and what the platform answers.

Fictional brand: **Meridian Pay**, a payouts platform. Person **Jordan Ellis** asks a
concierge agent about payouts; specialists (`meridian-payouts`, `meridian-payments`)
do the work; a platform-signed external agent acts for Jordan.

## Status

- [x] Planned (source: walkthrough video of the AgentIAMCore "w-pay A2A, one hop at a time" demo, rebuilt on PingOne + PingOne Privilege)
- [ ] Phase 0 scaffold (this commit)
- [ ] Phase 1 mock mode (fully offline, stub issuer with third-party trusted-issuer registry, mock Privilege doors, refusal matrix)
- [ ] Phase 2 real mode (PingOne pi.flow sign-in, measured third-party token exchange, HAProxy-fronted gateway doors)
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
