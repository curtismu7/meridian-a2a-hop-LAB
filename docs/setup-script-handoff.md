# Meridian-a2a-hop-LAB — setup-script handoff (2026-11-03)

**Audience:** the agent writing the one-command setup script for meridian-a2a-hop-LAB.
**Goal:** a brand-new user brings ONLY a PingOne environment + a Worker app
(client id/secret, `client_credentials`); the script provisions everything else and
proves the whole chain live. This doc records exactly what exists today, what the
script must create, the measured API shapes, and the traps that cost this session hours.

---

## 1. What exists today (our tenant, do not mutate)

| Piece | Where |
|---|---|
| meridian-mcp backend (Deployment + Service) | SE cluster `ping-devops-cmuir`, image `ghcr.io/ping-sandbox/meridian-mcp:latest` (arm64; port 8899 → svc 80) |
| Privilege doors `meridian-payouts`, `meridian-payments` | Agentic Apps (MCP Server), backend `http://meridian-mcp.ping-devops-cmuir.svc.cluster.local/mcp`, EntryPath `/mcp`, MeshCluster `ai-demo-cmuir`, AuthMode `static-token` (irrelevant — see §3) |
| NHI `MeridianAgent` | workload-identity federation: Issuer `https://auth.pingone.com/01d89b06-…/as`, JwksURI `…/as/jwks`, Audience `meridian-api`, Subject `*`, AllowAnySubject, RequiredClaims `{client_id: <payouts client>}`, Platform `oidc`, SubjectBinding `opaque` |
| Agent access key `meridian-agent` | mcp scope, CustodianRef → MeridianAgent |
| PacPolicies `MalheurRiver-4843334b6f4e` (payouts), `RiverWelland-6c554d4a4d48` (payments) | IssuedTo includes the demo user + our NHI; per-app tool allowlists |
| Demo apps in PingOne env `01d89b06-66d5-430e-9f28-65636843788b` | web / concierge / payouts / payments OAuth clients, trusted-issuer registration for the external platform, `jordan.ellis` user |
| Everything above is also mirrored in `~/Development/.env` (`MERIDIAN_*` keys) | |

## 2. What the setup script must create (in the USER's tenant/cluster)

PingOne side (all via the **worker token** — Management API `https://api.pingone.com/v1`):

1. OAuth apps (Worker-created, `client_secret_basic`):
   - `meridian-web` (the pi.flow sign-in client; needs the native-flow/pi.flow config)
   - `meridian-concierge` (token-exchange client, third-party subject+actor)
   - `meridian-payouts`, `meridian-payments` (specialist clients)
2. Scopes: `mp:concierge`, `mp:payouts`, `mp:payments`; resource/audience `meridian-api`
   (check `MERIDIAN_RESOURCE_AUD`).
3. Trusted-issuer registration for the external platform (the third-party JWT signer;
   the app carries its private JWK in `MERIDIAN_EXTERNAL_PRIVATE_JWK_B64`).
4. Demo user `jordan.ellis` (+ password from the user's chosen value).
5. `MERIDIAN_TRUSTED_ISSUER`/`MERIDIAN_TRUSTED_ISSUER_ID` capture.

PingOne Privilege side (see §4 — console API, not the worker):

6. Deploy `meridian-mcp` to the SE cluster (namespace `ping-devops-cmuir` to match the
   doors; Deployment + ClusterIP svc, image public-or-pull-secret).
7. Register the two doors as Agentic Apps (MCP Server) — names ARE the door URLs.
8. NHI + agent access key + policy wiring (§3).
9. Write the user's `.env` with all `MERIDIAN_*` keys (exact list: §5).
10. Smoke test: run the 7-hop chain live and assert hop 6 returns 200 + payout records,
    and the two refusals (H-5, H-7) 403.

## 3. The door-auth pattern (the part that cost the most)

The Privilege gateway **never validates PingOne JWTs on MCP doors**. Measured:

- `ResourceOAuth`/`AuthMode: "static-token"` does NOT validate PingOne tokens — the
  gateway looks the raw bearer up in its own token store → `auth rejected:
  reason=token_not_found` regardless of config. Client credentials/token-exchange at the
  door's `/token` → `Invalid client credentials` (its AS only knows DCR'd browser clients).
- **Working pattern — NHI workload-identity federation** (full recipe in memory:
  `~/.claude/projects/-Users-cmuir--agents/memory/privilege-door-pingone-token-auth.md`):
  1. POST `nonhumanidentities`: Federation.Issuer REQUIRED. Issuer = user's PingOne
     `…/as`, JwksURI = `…/as/jwks`, Audience = the resource aud (`meridian-api`),
     RequiredClaims `{client_id: <payouts client id>}`, Platform `oidc`,
     SubjectBinding `opaque`, AllowAnySubject true.
  2. POST `agentaccesskeys` with CustodianRef → NHI
     (RefID = base64(`{tenant}@@@default@@@{nhiName}`)). Scopes `['mcp']`.
  3. PUT each door's PacPolicy: append `{RefKind:'NonHumanIdentity', RefID:<same base64>}`
     to `IssuedTo.ObjectRef`. **No policy = DENY ALL.**
  4. Caller presents the plain PingOne bearer at `https://<door>/mcp`. Propagation of
     policy/key changes ≈ 2–4 min — do not retest sooner (the script should sleep/poll).

## 4. Console API access (the automation path)

- **Local desktop console** `https://local.procyon.ai:8643` (PingOne Privilege.app must
  run; self-signed cert): key/secret from Settings → For Developers as `x-api-key`/
  `x-api-secret` (+ required-but-unvalidated `x-procyon-session-id` UUID). Reference
  script: the `bootstrap-hostile-governed.mjs` script in the main demo repo's
  `privilege/scripts/` directory (clone/policy
  shapes, the `@@@` vs `@@` separator trap).
- **Cloud console** `console.privilege.pingone.com`: worker tokens are REJECTED (401,
  measured). Only the browser `auth_token` cookie works. If the user's Privilege tenant
  is cloud-only, the script cannot fully automate door registration without either the
  local desktop app or a hand-off step. **Decide and document this limitation.**
- Console API shapes: Swagger `https://local.procyon.ai:8643/swagger/imodel.swagger.json`
  (no securityDefinitions; PUT = read-modify-write whole object; app names immutable).

## 5. Env keys the script must produce (exact names, from ~/Development/.env)

```
MERIDIAN_PINGONE_ENV_ID  MERIDIAN_PINGONE_REGION
MERIDIAN_WEB_CLIENT_ID/SECRET          MERIDIAN_CONCIERGE_CLIENT_ID/SECRET
MERIDIAN_PAYOUTS_CLIENT_ID/SECRET      MERIDIAN_PAYMENTS_CLIENT_ID/SECRET
MERIDIAN_TRUSTED_ISSUER  MERIDIAN_TRUSTED_ISSUER_ID  MERIDIAN_RESOURCE_AUD
MERIDIAN_USER_USERNAME   MERIDIAN_USER_PASSWORD
MERIDIAN_EXTERNAL_PRIVATE_JWK_B64
MERIDIAN_MCP_DOOR_PAYOUTS_URL   https://mcpgw.ai-demo.ping-devops.com/meridian-payouts/mcp
MERIDIAN_MCP_DOOR_PAYMENTS_URL  https://mcpgw.ai-demo.ping-devops.com/meridian-payments/mcp
```

## 6. Measured traps (all hit live 2026-11-03)

- **PingOne password set:** `PUT /v1/environments/{env}/users/{id}/password`, content-type
  `application/vnd.pingidentity.password.set+json`, body `{"value": "…"}` — the field is
  `value` (a `password` field gives EMPTY_VALUE; POST gives 415). Build the JSON with
  `python3 -c "import json,os;…"` — shell-interpolating a password with special chars
  silently produces an empty value.
- **Dockerfile COPY:** the app image must `COPY stub-issuer` (server imports it from
  `../../../stub-issuer/`) — missing it = crash loop `ERR_MODULE_NOT_FOUND`.
- **App names are immutable** in the console (rename = delete + recreate; back up first).
- **Policy rule app refs** encode `tenant@@@default@@@<app>` (triple @); IssuedTo refs
  encode `tenant@@default@@<user-or-nhi>` (double @). Wrong separator silently matches
  nothing.
- **FrontEndName** must be the door's own host (`<app>.default.applications.procyon.ai:8643`)
  — cloning an app copies the source's frontend and misroutes.
- **ghcr pull:** the cluster's existing `ghcr-pull-secret` covers ping-sandbox private
  images; a test pod pulling the image is a cheap pre-flight.
- **SE cluster:** context `us`; deploy meridian-mcp in `ping-devops-cmuir` (that's the
  namespace the doors' backend URLs use; both gateway nodes serve every app).
- **Token-exchange facts (measured):** without an actor, PingOne issues `act.sub = null`;
  the third-party actor token must ride as `actor_token` (jwt type) so `act.sub` maps.
- **pi.flow:** the credential-submit content-type MUST be the vendor one
  (`application/vnd.pingidentity.usernamePassword.check+json`); plain JSON is refused.
- **Verification, never stamps:** the script's final step must be the live chain
  (hop 6 = 200 with records, H-5/H-7 = 403), not "POST returned 201".

## 7. Verification commands that work today (for the smoke test)

```sh
# real-mode host run of the app (the container is mock-only):
set -a; source <user>/.env; set +a
PORT=6602 DEMO_MODE=real node server/src/index.js &
curl -X POST :6602/api/flow/run -d '{"step":"sign-in"}'
curl -X POST :6602/api/flow/sign-in-submit -d '{"username":"jordan.ellis","password":"…"}'
curl -X POST :6602/api/flow/run -d '{"step":"external-agent"}'
curl -X POST :6602/api/flow/run -d '{"step":"third-party-exchange"}'
curl -X POST :6602/api/flow/run -d '{"step":"concierge-decides"}'
curl -X POST :6602/api/flow/run -d '{"step":"exchange-payouts"}'
curl -X POST :6602/api/flow/run -d '{"step":"mcp-payouts"}'          # expect 200 + records
curl -X POST :6602/api/flow/run -d '{"step":"mcp-payouts","overrides":{"body":{"door":"meridian-payments"}}}'  # 403 H-7
curl -X POST :6602/api/flow/run -d '{"step":"mcp-payouts","overrides":{"tool":"take_guest_payment"}}'          # 403 H-5
```

## 8. Open decisions for the script's design

1. Cloud-only Privilege tenant: interactive fallback or local-app requirement? (§4)
2. Where the external platform's private JWK comes from: generated per-tenant by the
   script (preferred) vs user-supplied.
3. Whether the script also registers the app on the demo shelf
   (`docs/shelf-entry.json` + `scripts/shelf-register.mjs` already exist in the repo).
4. Owner policy: deploy only to local Docker EXCEPT this backend, which must live in the
   SE cluster namespace `ping-devops-cmuir` (it's the door backend; the app itself stays local).
