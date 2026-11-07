# Architecture - meridian-a2a-hop-LAB

```
web (React/Vite, :7720/dist)   server (Express, 127.0.0.1:7720)
        │  /api/*                        │
        │                     ┌──────────┴───────────┐
        └────────────────────►│  step orchestrator   │
                              │  - flow state        │
                              │  - request templates │
                              │  - placeholder fill  │  secrets: server-side only
                              │  - captured tokens   │
                              └──────────┬───────────┘
                                         │  mode=mock            mode=real (Phase 2)
                              ┌──────────┴─────────┐  ┌──────────────────────────┐
                              │ stub-issuer :7721  │  │ PingOne /as/token        │
                              │ - keypair, JWKS    │  │ pi.flow sign-in          │
                              │ - trusted issuers  │  │ third-party exchange     │
                              │   (2nd keypair)    │  │ (trusted issuer + JWKS)  │
                              └──────────┬─────────┘  └──────────────────────────┘
                                         │
                              ┌──────────┴─────────┐
                              │ mock privilege door│   real: HAProxy -> 3-node mesh
                              │ - required claims  │   gateway, doors registered via
                              │ - tool policy      │   Privilege console (Phase 2)
                              └──────────┬─────────┘
                                         │
                              ┌──────────┴─────────┐
                              │ mock MCP server    │
                              │ query_account_...  │
                              │ take_guest_payment │  (refusal bait)
                              └────────────────────┘
```

## Trust domains (the point of the demo)

- **Same-domain tokens**: minted by the platform issuer (stub-issuer keypair 1 / PingOne).
  Person sign-in and all RFC 8693 exchanges between platform clients live here.
- **Third-party tokens**: signed by the external platform's keypair (stub-issuer keypair 2,
  registered as a *trusted issuer* with its JWKS). These never sign platform tokens; they
  enter only as `subject_token` / `actor_token` and leave as domain tokens with `act` set.

## Components

| Path | What |
| --- | --- |
| `server/src/index.js` | Express app: static web/dist, /api routes, /api/health |
| `server/src/flow/` | step definitions, orchestrator, refusal matrix |
| `server/src/exchange.js` | RFC 8693 client (form-encoded, basic auth) |
| `server/src/trustedIssuers.js` | third-party issuer registry + JWKS fetch/verify |
| `server/src/placeholders.js` | `{basic:...}` style server-side secret fill |
| `server/src/tokens.js` | capture, decode, claim-diff per hop |
| `stub-issuer/server.mjs` | mock AS: /as/token, /jwks, keypairs, error table |
| `web/src/` | React app: swimlane, step sidebar, request editor, response tabs |

## Ports

| Port | Use |
| --- | --- |
| 7720 | app (server + built web), loopback only |
| 7721 | stub-issuer host-run only (in Docker: internal network, unpublished) |
