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
