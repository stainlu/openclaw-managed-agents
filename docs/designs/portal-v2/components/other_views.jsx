// Overview / Agents / Audit views + Tweaks panel

function OverviewView() {
  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '32px 40px 28px' }}>
        <Eyebrow>Managed Agents · 4-primitive REST API</Eyebrow>
        <h1 style={{ marginTop: 10, fontSize: 42, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1.05 }}>
          Autonomous agents, your cloud,<br/><span style={{ color: 'var(--ink-3)' }}>any model.</span>
        </h1>
        <p style={{ marginTop: 14, maxWidth: '58ch', fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          One Docker container per session. HMAC-durable event queue. Real SSE streaming. Lives on your $4 Hetzner VPS or anywhere Docker runs.
        </p>
      </div>

      <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
          {STATS.map((s, i) => (
            <div key={i} style={{
              padding: '18px 20px',
              borderRight: i < STATS.length - 1 ? '1px solid var(--ink)' : 0,
            }}>
              <Eyebrow>{s.label}</Eyebrow>
              <div style={{ marginTop: 8, fontSize: 28, fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1 }}>{s.value}</div>
              <Mono s={11} c="var(--ink-3)" style={{ marginTop: 6, display: 'block' }}>{s.sub}</Mono>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px' }}>
        <div style={{ padding: '28px 40px', borderRight: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid var(--ink)' }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 500, letterSpacing: '-0.022em' }}>Recent sessions</h2>
            <Mono s={11} c="var(--ink-3)">auto-refresh · 5s</Mono>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 110px 88px 88px', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            {['Session', 'Agent', 'Status', 'Turns', 'Cost'].map(h => <Eyebrow key={h}>{h}</Eyebrow>)}
          </div>
          {SESSIONS.slice(0, 6).map(s => (
            <div key={s.id} style={{
              display: 'grid', gridTemplateColumns: '160px 1fr 110px 88px 88px',
              gap: 16, padding: '12px 0', borderBottom: '1px solid var(--line)',
              alignItems: 'center',
            }}>
              <Mono s={12} c="var(--ink)">{s.id}</Mono>
              <span style={{ fontSize: 13, color: 'var(--ink)' }}>{s.agent}</span>
              <StatusBadge s={s.status} />
              <Mono s={12} c="var(--ink-2)">{s.turns}</Mono>
              <Mono s={12} c="var(--ink)">${s.cost.toFixed(3)}</Mono>
            </div>
          ))}
        </div>
        <div style={{ padding: '28px 32px' }}>
          <Eyebrow>Quickstart · curl</Eyebrow>
          <pre style={{
            margin: '10px 0 0', fontSize: 11, lineHeight: 1.6,
            background: 'var(--ink)', color: 'var(--paper)',
            padding: 14, borderRadius: 6, overflow: 'auto',
            border: '1px solid var(--ink)',
          }}>{`# Create agent
POST /v1/agents
  model: moonshot/kimi-k2.5
  instructions: "…"

# Open session
POST /v1/sessions
  agentId: ag_7k2fLq

# Stream events
GET /v1/sessions/:id/events
  ?stream=true
  Last-Event-ID: evt_42`}</pre>
          <div style={{ marginTop: 14, padding: '12px 14px', border: '1px solid var(--line-2)', background: 'var(--card)', borderRadius: 6 }}>
            <Eyebrow>Or the OpenAI SDK, drop-in</Eyebrow>
            <pre style={{ margin: '8px 0 0', fontSize: 11, lineHeight: 1.55, color: 'var(--ink)', background: 'transparent' }}>{`client = OpenAI(
  base_url="…/v1",
  default_headers={
    "x-openclaw-agent-id": "ag_7k2fLq",
  })`}</pre>
          </div>
          <div style={{ marginTop: 14 }}>
            <Eyebrow>Restart-safe</Eyebrow>
            <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none' }}>
              {[
                'Durable event queue (SQLite WAL)',
                'HMAC subagent tokens persist',
                'Running containers re-adopted on boot',
                'Observer-side run completion',
              ].map(x => (
                <li key={x} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                  <Icon n="check" s={12} style={{ color: 'var(--ok)', marginTop: 3 }} />
                  <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{x}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentsView() {
  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '28px 40px 20px', borderBottom: '1px solid var(--ink)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24 }}>
          <div>
            <Eyebrow>v1 · agents</Eyebrow>
            <h1 style={{ marginTop: 8, fontSize: 36, fontWeight: 500, letterSpacing: '-0.035em' }}>Agents</h1>
            <p style={{ marginTop: 8, maxWidth: '56ch', fontSize: 14, color: 'var(--ink-2)' }}>
              Reusable configs: model, instructions, tools, MCP servers, permission policy, delegation rules, quotas. Versioned with immutable history.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="md" icon="docs">Spec</Button>
            <Button variant="hard" size="md" icon="plus">New agent</Button>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 40px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 180px 120px 100px 90px 90px', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--line)' }}>
          {['Name', 'Model · tools · MCP', 'Policy', 'Version', 'Sessions', 'Cost · 24h', 'Updated'].map(h => <Eyebrow key={h}>{h}</Eyebrow>)}
        </div>
        {AGENTS.map(a => (
          <div key={a.id} style={{
            display: 'grid', gridTemplateColumns: '220px 1fr 180px 120px 100px 90px 90px',
            gap: 16, padding: '16px 0', borderBottom: '1px solid var(--line)',
            alignItems: 'center', cursor: 'pointer',
            transition: 'background 120ms var(--ease)',
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--paper-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.015em' }}>{a.name}</div>
              <Mono s={11} c="var(--ink-3)">{a.id}</Mono>
            </div>
            <div>
              <Mono s={12} c="var(--ink)">{a.model}</Mono>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {a.tools.slice(0, 3).map(t => (
                  <span key={t} style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10,
                    padding: '1px 6px', border: '1px solid var(--line)',
                    background: 'var(--card)', color: 'var(--ink-3)', borderRadius: 3,
                  }}>{t}</span>
                ))}
                {a.tools.length > 3 && <Mono s={10} c="var(--ink-4)">+{a.tools.length - 3}</Mono>}
                {a.mcp.map(m => (
                  <span key={m} style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10,
                    padding: '1px 6px', border: '1px solid var(--ink)',
                    background: 'var(--ink)', color: 'var(--paper)', borderRadius: 3,
                  }}>mcp · {m}</span>
                ))}
              </div>
            </div>
            <div>
              {a.policy === 'always_ask' && <Badge tone="soft">always_ask</Badge>}
              {a.policy === 'always_allow' && <Badge tone="neutral">always_allow</Badge>}
              {a.policy === 'deny' && <Badge tone="warn">deny</Badge>}
            </div>
            <Mono s={12} c="var(--ink-2)">v{a.version} · latest</Mono>
            <Mono s={12} c="var(--ink)">{a.sessions.toLocaleString()}</Mono>
            <Mono s={12} c="var(--ink)">{a.cost24h}</Mono>
            <Mono s={11} c="var(--ink-3)">{a.updated}</Mono>
          </div>
        ))}
      </div>
    </div>
  );
}

function AuditView() {
  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '28px 40px 20px', borderBottom: '1px solid var(--ink)' }}>
        <Eyebrow>v1 · audit</Eyebrow>
        <h1 style={{ marginTop: 8, fontSize: 36, fontWeight: 500, letterSpacing: '-0.035em' }}>Audit log</h1>
        <p style={{ marginTop: 8, maxWidth: '58ch', fontSize: 14, color: 'var(--ink-2)' }}>
          Every mutating API call. Queryable, retained {' '}
          <code>OPENCLAW_AUDIT_RETENTION_DAYS</code> (default 30). Newest first.
        </p>
      </div>
      <div style={{ padding: '0 40px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '240px 160px 200px 200px 1fr', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--line)' }}>
          {['Timestamp', 'Actor', 'Action', 'Target', 'Outcome'].map(h => <Eyebrow key={h}>{h}</Eyebrow>)}
        </div>
        {AUDIT_ROWS.map((r, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '240px 160px 200px 200px 1fr',
            gap: 16, padding: '10px 0', borderBottom: '1px solid var(--line)', alignItems: 'center',
          }}>
            <Mono s={11} c="var(--ink-2)">{r.ts}</Mono>
            <Mono s={11} c="var(--ink-2)">{r.actor}</Mono>
            <Mono s={12} c="var(--ink)">{r.action}</Mono>
            <Mono s={11} c="var(--ink-2)">{r.target}</Mono>
            <span style={{ fontSize: 12, color: r.outcome === 'ok' ? 'var(--ok)' : 'var(--danger)' }}>{r.outcome}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EnvironmentsView() {
  const envs = [
    { id: 'env_default', name: 'default', packages: '—', net: 'unrestricted', sessions: 12 },
    { id: 'env_py_stdlib', name: 'py-stdlib', packages: 'pip: requests, httpx, beautifulsoup4', net: 'unrestricted', sessions: 1 },
    { id: 'env_locked', name: 'locked-anthropic', packages: 'pip: anthropic', net: 'limited · api.anthropic.com', sessions: 0 },
  ];
  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '28px 40px 20px', borderBottom: '1px solid var(--ink)' }}>
        <Eyebrow>v1 · environments</Eyebrow>
        <h1 style={{ marginTop: 8, fontSize: 36, fontWeight: 500, letterSpacing: '-0.035em' }}>Environments</h1>
        <p style={{ marginTop: 8, maxWidth: '56ch', fontSize: 14, color: 'var(--ink-2)' }}>
          Container shapes: packages (pip / apt / npm) + networking policy. Composed with agents at session time.
        </p>
      </div>
      <div style={{ padding: '0 40px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 200px 100px', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--line)' }}>
          {['Name', 'Packages', 'Networking', 'Sessions'].map(h => <Eyebrow key={h}>{h}</Eyebrow>)}
        </div>
        {envs.map(e => (
          <div key={e.id} style={{
            display: 'grid', gridTemplateColumns: '220px 1fr 200px 100px',
            gap: 16, padding: '16px 0', borderBottom: '1px solid var(--line)', alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{e.name}</div>
              <Mono s={11} c="var(--ink-3)">{e.id}</Mono>
            </div>
            <Mono s={12} c="var(--ink-2)">{e.packages}</Mono>
            {e.net === 'unrestricted'
              ? <Badge tone="neutral">unrestricted</Badge>
              : <Badge tone="soft">{e.net}</Badge>}
            <Mono s={12} c="var(--ink)">{e.sessions}</Mono>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlaceholderView({ title, sub }) {
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: 'var(--paper)' }}>
      <div style={{ textAlign: 'center' }}>
        <Eyebrow>{title}</Eyebrow>
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-3)' }}>{sub}</div>
      </div>
    </div>
  );
}

Object.assign(window, { OverviewView, AgentsView, AuditView, EnvironmentsView, PlaceholderView });
