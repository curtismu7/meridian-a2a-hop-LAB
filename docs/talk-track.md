# Talk track - Meridian Pay A2A, one hop at a time

Fictional brand: **Meridian Pay**, a payouts platform for creators. Person: **Jordan Ellis**.
The demo walks the delegation chain hop by hop; every hop is one form, prefilled from the
step before, and every hop shows the token it carried.

## The story in one line

Jordan asks a concierge agent about payouts. The concierge cannot call payouts itself: it
must exchange tokens, hop by hop, and each hop is checked - by the authorization server and
by the Privilege doors - and the wrong hop is refused, on purpose, on screen.

## Hop list (mock mode today; real PingOne in Phase 2)

1. **Sign in** - Jordan signs in to Meridian Pay (pi.flow-style native form). The access
   token says `sub=jordan`, `aud=meridian-web`.
2. **External agent arrives** - the platform-signed agent (SPIFFE-style workload identity,
   signed by a *third-party* issuer) presents its JWT. Trust in that issuer was established
   once at PingOne (issuer string + JWKS). This replaces the video's "Agent App in AIC" step.
3. **Third-party token exchange** - the external agent exchanges: `subject_token=platform
   JWT`, `actor_token=platform agent JWT`, `actor_token_type=urn:...jwt`. Out comes a
   domain token with `act.sub=<spiffe id>`. (Try it wrong: `actor_token_type=access_token`
   is refused; an unknown `iss` is refused.)
4. **Concierge decides** - the concierge picks the specialist (payouts) for Jordan's intent.
5. **Exchange: concierge -> payouts** - the person token is exchanged for a specialist token:
   audience `meridian-payouts-rs`, scope `mp:payouts`, `act.sub` = `meridian-concierge`.
6. **Token -> MCP: query_account_payouts** - the specialist's token opens its Privilege door
   (required claims: `act.sub`, `client_id`) and calls the MCP tool.
   Refusals demoed here: skip the concierge exchange (401, required `act.sub` missing);
   another specialist's token (403, not scoped); the payments door (403, no privilege for it).
7. **Payments hop** (optional) - the same shape against `meridian-payments`, including the
   refusal-bait tool `take_guest_payment` (403: the policy lists only this specialist's tools).
8. **The delegation chain** - every token side by side: `sub` and `act` per hop, what each
   exchange changed, highlighted.

## After the flow

- **LLM hop by hand** - the same chain with a real LLM decision (Phase 2: Privilege LLM
  gateway; mock mode: the deterministic router shows the decision inputs).
- **v1.1** - A2A chat tail: agent card, chat with task status, compliance badges per message.

## The external-agent / third-party section (why this demo differs from the video)

The source demo ran in one trust domain: the agent-privilege product was also the IDP/AS, so
every token came from the same issuer. For an **external** agent - a platform-signed identity
or SPIFFE workload - that does not work: you cannot register the agent as an "app" in a
domain that never issued it. Instead you establish **trust in the issuer** at PingOne
(trusted issuer: exact issuer string + JWKS), then accept its signed JWTs as `subject_token`
and `actor_token` in a token exchange. The actor chain is therefore built **at PingOne**, not
at the gateway.

Known platform limitation (say it plainly in demos): Privilege's on-behalf-of exchange today
has no actor_token option and is MCP-config only, not remote-agent (A2A). The demo's honest
answer: the actor identity rides in the token minted at PingOne, and the doors check it as a
required claim.

## Mode header

Mock (default, fully offline) vs Real (owner-run, PingOne + Privilege). The header always
shows which mode is live; Real is refused unless configured, and switching never silently
changes what a token proves.
