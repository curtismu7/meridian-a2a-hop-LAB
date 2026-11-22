# CLAUDE.md - meridian-a2a-hop-LAB

Node 26 ESM monorepo (server + web workspaces). Port 7720, loopback only. Mock mode is
the default and must be fully offline; real mode (PingOne + Privilege) is owner-run.

- Rules source: `~/Development/STANDALONE-RULES.md`. Never import from AI-DEMO2 or other labs.
- Tests: server `npm test -w server` (vitest), web `npm test -w web` (vitest). E2E: `npm run e2e` (Playwright).
- UI standard: `npm run check:ui` (shared checker, copied from demo-kit-base). Dark + light, no purple, 375px.
- Diagrams: ReactFlow from shared diagram-studio data. Never mermaid.
- Tokens are shown raw on purpose (education); client secrets and issuer private keys are write-only server side.
- Mock sign-in guard: `IDP=mock` AND `ALLOW_MOCK_SIGNIN=1`, refused on non-loopback bind.
- The step flow mirrors the AgentIAMCore "one hop at a time" walkthrough, rebuilt on PingOne:
  pi.flow sign-in (Phase 2), third-party token exchange for the external agent (actor_token, jwt type,
  trusted-issuer registry), RFC 8693 exchanges per specialist, Privilege doors with required claims.
- Privilege OBO limitation (state it honestly in UI copy): no actor_token option, MCP-config only - the
  external agent's actor chain is established at PingOne token exchange, then the resulting token goes
  through the doors.
- "What Privilege did" (rule 25) on the door hop (`mcp-payouts`): `web/src/gateway-trace/` and `server/src/gatewayTrace.js` are
  vendored byte for byte from AI-DEMO-Standalone `shared/gateway-trace` and pinned by `gateway-trace.sha256` (never hand-edit;
  re-vendor, re-pin; the server copy is `gatewayTrace.js`, never `trace.js`). `server/src/doorTrace.js` builds the records and the run
  reply carries them as `gatewayTrace` (`traceNote` instead when nothing went to the gateway). Mock: the simulated door
  (`stub-issuer/doors.mjs` `checkDoorDetailed`) computed each check, so decisions are `checked`. Real: the gateway reports no per-check
  detail, so decisions are `inferred` or `observed`, never `checked`; the lab's own claim pre-check and the local-backends fallback send
  nothing to the gateway and have no trace. The token is never in a trace (mock: shortened, real: length only). The wording is about a
  delegated call between agents, via the builder's `grant` option.
- Run observability (rule 27): `web/src/run-observability/` and `server/src/runObservability.js` are vendored byte for byte from
  AI-DEMO-Standalone `shared/run-observability` and pinned by `run-observability.sha256` (never hand-edit; re-vendor, re-pin; the pin lists
  the server file as plain `runObservability.js`). The lab's own half is `server/src/runLog.js`: it records each decision a step made (Mock:
  from what the mock issuer, door and backend computed, so `simulated`; Real: only replies the lab received, so `response`) and writes one
  stdout line per decision; `GET /api/run-observability` builds the record for the current mode. Real reads Elasticsearch through
  `readersFromEnv()` (`RUN_OBS_ES_URL`, `RUN_OBS_ES_READ_APIKEY`); never mount the Docker socket. Never add an event the step did not compute.
