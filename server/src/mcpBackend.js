// The Meridian MCP backend: a small streamable-HTTP MCP server exposing the payouts tools.
// Deployed as the Privilege door's backend; auth happens at the gateway (required claims),
// so this server deliberately does not re-check bearer tokens (like the other lab backends).
// Endpoints:
//   GET  /health    -> ok
//   POST /mcp       -> JSON-RPC 2.0 (initialize, tools/list, tools/call)
import express from 'express'
import { SEED_PAYOUTS } from './payoutsData.js'

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '64kb' }))

let payouts = structuredClone(SEED_PAYOUTS)

const TOOLS = [
  {
    name: 'query_account_payouts',
    description: 'List the person’s recent Meridian payouts (id, state, amount, date).',
    inputSchema: {
      type: 'object',
      properties: { pageSize: { type: 'number', description: 'How many payouts to return (max 20)' } },
    },
  },
  {
    name: 'take_guest_payment',
    description: 'Take a guest payment. The payments door’s write: records the payment and returns a receipt.',
    inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
  },
]

app.get('/health', (_req, res) => res.json({ ok: true, app: 'meridian-mcp', tools: TOOLS.map((t) => t.name) }))

app.post('/mcp', (req, res) => {
  const { id, method, params } = req.body || {}
  const reply = (result) => res.json({ jsonrpc: '2.0', id: id ?? null, result })
  const err = (code, message) => res.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'meridian-payouts-mcp', version: '0.1.0' },
      })
    case 'tools/list':
      return reply({ tools: TOOLS })
    case 'tools/call': {
      const name = params?.name
      const args = params?.arguments || {}
      if (name === 'query_account_payouts') {
        const size = Math.min(Number(args.pageSize) || 5, 20)
        return reply({
          content: [{ type: 'text', text: JSON.stringify(payouts.slice(0, size)) }],
        })
      }
      if (name === 'take_guest_payment') {
        // Real mode: the payments door's one write. Record a seeded guest payment and return a receipt.
        const amount = Number(args.amount)
        if (!Number.isFinite(amount) || amount <= 0) {
          return reply({ content: [{ type: 'text', text: 'amount must be a positive number' }], isError: true })
        }
        const receipt = {
          payoutId: `po_${Math.floor(1000 + Math.random() * 9000)}`,
          state: 'COMPLETED',
          amount,
          currency: 'USD',
          account: 'Meridian guest',
          date: new Date().toISOString().slice(0, 10),
          reference: 'GP-MCP',
        }
        payouts.unshift(receipt)
        return reply({ content: [{ type: 'text', text: JSON.stringify(receipt) }] })
      }
      return err(-32602, `Unknown tool: ${name}`)
    }
    case 'notifications/initialized':
      return res.status(202).end()
    default:
      return err(-32601, `Method not found: ${method}`)
  }
})

// Reset for tests
app.post('/__reset', (_req, res) => {
  payouts = structuredClone(SEED_PAYOUTS)
  res.json({ ok: true })
})

const port = Number(process.env.PORT || 8899)
const host = '0.0.0.0'
app.listen(port, host, () => console.log(`meridian-mcp listening on ${host}:${port}`))
