const { useState: useStateSessions, useMemo: useMemoSessions } = React;

function StatusBadge({ s }) {
  if (s === 'running') return <Badge tone="live">Running</Badge>;
  if (s === 'awaiting') return <Badge tone="soft">Awaits approval</Badge>;
  if (s === 'idle') return <Badge tone="neutral">Idle</Badge>;
  if (s === 'ended') return <Badge tone="ok">Ended</Badge>;
  if (s === 'failed') return <Badge tone="err">Failed</Badge>;
  if (s === 'quota') return <Badge tone="warn">Quota hit</Badge>;
  return <Badge tone="neutral">{s}</Badge>;
}

// Meter bar — the "cost / quota" visual. Editorial: just a hairline track.
function Meter({ value, cap, unit = '', tone = 'ink', style }) {
  const pct = Math.min(100, (value / cap) * 100);
  const hot = pct > 92;
  const color = hot ? 'var(--danger)' : tone === 'ink' ? 'var(--ink)' : 'var(--accent, var(--lobster))';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      <div style={{ height: 2, background: 'var(--line)', position: 'relative', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, height: '100%',
          width: pct + '%', background: color,
          transition: 'width 240ms var(--ease)',
        }} />
      </div>
    </div>
  );
}

function SessionsList({ selectedId, onSelect, filter, setFilter }) {
  const filtered = filter === 'all' ? SESSIONS : SESSIONS.filter(s => s.status === filter);
  return (
    <div style={{
      width: 360, flexShrink: 0, height: '100%',
      borderRight: '1px solid var(--ink)',
      display: 'flex', flexDirection: 'column',
      background: 'var(--paper)',
    }}>
      <div style={{
        padding: '14px 16px 10px',
        borderBottom: '1px solid var(--line)',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <Eyebrow>Sessions · 14</Eyebrow>
          <Mono s={10} c="var(--ink-3)" style={{ marginLeft: 'auto' }}>SSE · 5s</Mono>
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
          {[
            ['all', 'All', 14],
            ['running', 'Running', 2],
            ['awaiting', 'Awaits', 1],
            ['idle', 'Idle', 1],
            ['failed', 'Failed', 1],
          ].map(([k, l, n]) => {
            const active = filter === k;
            return (
              <button key={k} onClick={() => setFilter(k)} style={{
                all: 'unset', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'baseline', gap: 5,
                fontSize: 12, fontWeight: 500,
                color: active ? 'var(--ink)' : 'var(--ink-3)',
                borderBottom: active ? '1px solid var(--ink)' : '1px solid transparent',
                paddingBottom: 2,
              }}>
                {l}
                <Mono s={10} c={active ? 'var(--ink-2)' : 'var(--ink-3)'}>{n}</Mono>
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.map(s => {
          const sel = s.id === selectedId;
          return (
            <button key={s.id} onClick={() => onSelect(s.id)} style={{
              all: 'unset', cursor: 'pointer', display: 'block',
              width: '100%', boxSizing: 'border-box',
              padding: '12px 16px',
              borderBottom: '1px solid var(--line)',
              background: sel ? 'var(--card)' : 'transparent',
              borderLeft: sel ? '2px solid var(--accent, var(--lobster))' : '2px solid transparent',
              transition: 'background 120ms var(--ease)',
            }}
              onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'var(--paper-2)'; }}
              onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Mono s={12} c="var(--ink)" style={{ fontWeight: 500 }}>{s.id}</Mono>
                <div style={{ marginLeft: 'auto' }}><StatusBadge s={s.status} /></div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <span style={{ fontSize: 13, color: 'var(--ink)' }}>{s.agent}</span>
                <Mono s={10} c="var(--ink-3)" style={{ marginLeft: 'auto' }}>{s.started}</Mono>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                <Mono s={10} c="var(--ink-3)">{s.turns} turns</Mono>
                <Mono s={10} c="var(--ink-3)">{(s.tokens/1000).toFixed(1)}k tok</Mono>
                <Mono s={10} c="var(--ink-3)" style={{ marginLeft: 'auto' }}>${s.cost.toFixed(3)}</Mono>
              </div>
              <Meter value={s.cost} cap={s.costCap} style={{ marginTop: 8 }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { SessionsList, StatusBadge, Meter });
