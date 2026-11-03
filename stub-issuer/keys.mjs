// JWT signing/verifying with ES256 keys built from createECDH (never the EC crypto keygen job:
// on Node 20 it aborted CI with SIGABRT - see standalone rules 58). Pattern from intent-par-inspector.
import { createECDH, createPrivateKey, createPublicKey, sign, verify, createHash } from 'node:crypto'

const b64u = (b) => Buffer.from(b).toString('base64url')
const fromB64u = (s) => Buffer.from(s, 'base64url')

export function createKeys() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const point = ecdh.getPublicKey() // 0x04 || X(32) || Y(32)
  const pub = { kty: 'EC', crv: 'P-256', x: b64u(point.subarray(1, 33)), y: b64u(point.subarray(33, 65)) }
  const privateKey = createPrivateKey({ key: { ...pub, d: b64u(ecdh.getPrivateKey()) }, format: 'jwk' })
  const publicKey = createPublicKey({ key: pub, format: 'jwk' })
  const kid = `mock-${createHash('sha256').update(JSON.stringify(pub)).digest('hex').slice(0, 12)}`
  return { privateKey, publicKey, kid, jwks: { keys: [{ ...pub, kid, use: 'sig', alg: 'ES256' }] } }
}

export function signJwt(payload, keys, iss) {
  const header = { alg: 'ES256', typ: 'at+jwt', kid: keys.kid }
  const full = { ...payload, iss, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + (payload.exp_in ?? 300) }
  delete full.exp_in
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(full))}`
  const sig = sign('sha256', Buffer.from(input), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' })
  return `${input}.${b64u(sig)}`
}

export function verifyJwt(token, keys) {
  const [h, p, s] = token.split('.')
  const ok = verify('sha256', Buffer.from(`${h}.${p}`), { key: keys.publicKey, dsaEncoding: 'ieee-p1363' }, fromB64u(s))
  if (!ok) throw new Error('bad signature')
  return JSON.parse(fromB64u(p).toString('utf8'))
}
