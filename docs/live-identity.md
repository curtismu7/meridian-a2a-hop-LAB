# Live-mode identities (Phase 2)

One identity runs the whole demo: `cmuir+demo-user@pingone.com` ("demouser"), env
`01d89b06-66d5-430e-9f28-65636843788b`.

- pi.flow person sign-in (real mode step 1) uses `MERIDIAN_USER_USERNAME`/`MERIDIAN_USER_PASSWORD`
  (in `~/Development/.env`, both set to demouser creds).
- Door OAuth (Privilege gateway, tenant 0428ba4f) JIT-provisions the same user; its email
  (`cmuir+demo-user@pingone.com`) is a real seemail address, so verification flows work.
- Both access policies grant demouser:
  `meridian-payouts permit (demo-user)` -> query_account_payouts,
  `meridian-payments permit (demo-user)` -> take_guest_payment.

jordan.ellis still exists in 01d89b06 (email `cmuir+jordan@pingone.com`, NOT verified) - a
door JIT sign-in as jordan.ellis emails a verification code to that seemail address. Prefer
demouser; if you use jordan.ellis you must read the code from the inbox once.

Door URLs: `https://mcpgw.ai-demo.ping-devops.com/meridian-{payouts,payments}/mcp`
(also in `~/Development/.env` as `MERIDIAN_MCP_DOOR_*_URL`).
