const { useState: useStateChrome } = React;

function Topbar({ route, setRoute, onTweaks }) {
  return (
    <header style={{
      height: 48, flexShrink: 0,
      borderBottom: '1px solid var(--ink)',
      display: 'grid', gridTemplateColumns: '240px 1fr auto',
      alignItems: 'stretch', background: 'var(--paper)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 18px',
        borderRight: '1px solid var(--ink)',
      }}>
        <LogoMark size={20} />
        <span style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.032em' }}>OpenClaw</span>
        <Mono s={10} c="var(--ink-3)" style={{ marginLeft: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Managed&nbsp;Agents
        </Mono>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 18px' }}>
        <Mono s={11} c="var(--ink-3)">org_</Mono>
        <Mono s={11} c="var(--ink)">stainlu</Mono>
        <Icon n="chevronR" s={11} style={{ color: 'var(--ink-4)', margin: '0 6px' }} />
        <Mono s={11} c="var(--ink-3)">deployment_</Mono>
        <Mono s={11} c="var(--ink)">prod-hetzner-cax11</Mono>
        <Badge tone="ok" style={{ marginLeft: 10 }}>healthy</Badge>
        <Mono s={11} c="var(--ink-3)" style={{ marginLeft: 10 }}>commit af1ec32 · 175/175 tests</Mono>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          border: '1px solid var(--line-2)', borderRadius: 6,
          padding: '4px 9px', background: 'var(--card)', minWidth: 240,
        }}>
          <Icon n="search" s={12} style={{ color: 'var(--ink-3)' }} />
          <span style={{ fontSize: 12, color: 'var(--ink-3)', flex: 1 }}>Jump to session, agent…</span>
          <Kbd>⌘K</Kbd>
        </div>
        <Button variant="ghost" size="sm" icon="spark" onClick={onTweaks}>Tweaks</Button>
        <Button variant="ghost" size="sm" icon="docs">Docs</Button>
        <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--ink)', color: 'var(--paper)', display: 'grid', placeItems: 'center', fontSize: 10, fontFamily: 'var(--font-mono)' }}>sl</div>
      </div>
    </header>
  );
}

function Sidebar({ route, setRoute }) {
  const items = [
    { id: 'overview',    label: 'Overview',     count: null,  icon: 'home' },
    { id: 'agents',      label: 'Agents',       count: 4,     icon: 'agents' },
    { id: 'environments', label: 'Environments', count: 3,    icon: 'env' },
    { id: 'sessions',    label: 'Sessions',     count: 14,    icon: 'sessions', live: true },
    { id: 'vaults',      label: 'Vaults',       count: 2,     icon: 'vaults' },
    { id: 'audit',       label: 'Audit log',    count: null,  icon: 'audit' },
    { id: 'metrics',     label: 'Metrics',      count: null,  icon: 'metrics' },
  ];
  return (
    <aside style={{
      width: 240, flexShrink: 0, height: '100%',
      borderRight: '1px solid var(--ink)',
      display: 'flex', flexDirection: 'column',
      background: 'var(--paper)', padding: '16px 0 0 0',
    }}>
      <div style={{ padding: '0 18px 10px' }}>
        <Eyebrow>API · v1</Eyebrow>
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', padding: '0 8px' }}>
        {items.map(item => {
          const active = route.view === item.id;
          return (
            <button key={item.id} onClick={() => setRoute({ view: item.id })} style={{
              all: 'unset', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px',
              borderRadius: 4,
              background: active ? 'var(--paper-3)' : 'transparent',
              color: active ? 'var(--ink)' : 'var(--ink-2)',
              fontSize: 13, fontWeight: active ? 500 : 400,
              position: 'relative',
              transition: 'background 120ms var(--ease), color 120ms var(--ease)',
            }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--paper-2)'; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <Icon n={item.icon} s={14} style={{ color: active ? 'var(--ink)' : 'var(--ink-3)' }} />
              <span>{item.label}</span>
              {item.live && <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: 'var(--accent, var(--lobster))',
                boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent, var(--lobster)) 25%, transparent)',
                animation: 'oc-pulse 2.4s var(--ease) infinite',
              }} />}
              {item.count !== null && (
                <Mono s={11} c={active ? 'var(--ink-2)' : 'var(--ink-3)'} style={{ marginLeft: 'auto' }}>
                  {item.count}
                </Mono>
              )}
            </button>
          );
        })}
      </nav>

      <div style={{ height: 1, background: 'var(--line)', margin: '16px 18px' }} />

      <div style={{ padding: '0 18px' }}>
        <Eyebrow>Deploy</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 8 }}>
          {[
            { n: 'Hetzner · CAX11', live: true, cost: '$4/mo' },
            { n: 'GCE · e2-medium', live: false, cost: '$25/mo' },
            { n: 'Lightsail · m_3_0', live: false, cost: '$24/mo' },
          ].map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: d.live ? 'var(--ok)' : 'var(--ink-4)',
              }} />
              <span style={{ color: d.live ? 'var(--ink)' : 'var(--ink-3)' }}>{d.n}</span>
              <Mono s={10} c="var(--ink-3)" style={{ marginLeft: 'auto' }}>{d.cost}</Mono>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 'auto', padding: '14px 18px', borderTop: '1px solid var(--ink)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--accent, var(--lobster))',
            boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent, var(--lobster)) 22%, transparent)',
          }} />
          <span style={{ fontSize: 12, fontWeight: 500 }}>Gateway up</span>
          <Mono s={10} c="var(--ink-3)" style={{ marginLeft: 'auto' }}>14d 2h</Mono>
        </div>
        <Mono s={10} c="var(--ink-3)" style={{ marginTop: 4, display: 'block' }}>
          api.openclaw.stainlu.dev
        </Mono>
      </div>
    </aside>
  );
}

Object.assign(window, { Topbar, Sidebar });
