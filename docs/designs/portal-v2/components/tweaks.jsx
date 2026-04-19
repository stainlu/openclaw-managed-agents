const { useState: useStateTweaks } = React;

function TweaksPanel({ tweaks, setTweaks, onClose }) {
  const Row = ({ label, sub, children }) => (
    <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{label}</div>
          {sub && <Mono s={10} c="var(--ink-3)" style={{ marginTop: 2, display: 'block' }}>{sub}</Mono>}
        </div>
        {children}
      </div>
    </div>
  );

  const Seg = ({ value, options, onChange }) => (
    <div style={{ display: 'flex', border: '1px solid var(--line-2)', borderRadius: 6, overflow: 'hidden' }}>
      {options.map(o => {
        const active = value === o.v;
        return (
          <button key={o.v} onClick={() => onChange(o.v)} style={{
            all: 'unset', cursor: 'pointer',
            padding: '5px 10px',
            fontSize: 11, fontFamily: 'var(--font-mono)',
            background: active ? 'var(--ink)' : 'var(--card)',
            color: active ? 'var(--paper)' : 'var(--ink-2)',
          }}>{o.l}</button>
        );
      })}
    </div>
  );

  const Swatch = ({ c, active, onClick }) => (
    <button onClick={onClick} style={{
      all: 'unset', cursor: 'pointer',
      width: 22, height: 22, borderRadius: '50%',
      background: c,
      boxShadow: active ? `0 0 0 2px var(--paper), 0 0 0 3px var(--ink)` : 'none',
    }} />
  );

  return (
    <div style={{
      position: 'fixed', right: 16, bottom: 16, zIndex: 100,
      width: 320,
      background: 'var(--card)',
      border: '1px solid var(--ink)',
      borderRadius: 8,
      boxShadow: '0 20px 40px rgba(20,20,19,0.10)',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{
        padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid var(--ink)',
      }}>
        <Icon n="spark" s={13} />
        <span style={{ fontSize: 13, fontWeight: 500 }}>Tweaks</span>
        <Mono s={10} c="var(--ink-3)" style={{ marginLeft: 6 }}>dashboard</Mono>
        <button onClick={onClose} style={{
          all: 'unset', cursor: 'pointer', marginLeft: 'auto',
          color: 'var(--ink-3)', padding: 4,
        }}>
          <Icon n="close" s={13} />
        </button>
      </div>

      <Row label="Density" sub="13px dev-tool vs 15px broader">
        <Seg value={tweaks.density} onChange={v => setTweaks({ ...tweaks, density: v })}
          options={[{ v: 'compact', l: '13' }, { v: 'comfy', l: '15' }]} />
      </Row>

      <Row label="Session state" sub="cycle through lifecycle">
        <Seg value={tweaks.sessionState} onChange={v => setTweaks({ ...tweaks, sessionState: v })}
          options={[
            { v: 'running', l: 'run' },
            { v: 'awaiting', l: 'ask' },
            { v: 'quota', l: 'quota' },
            { v: 'failed', l: 'fail' },
          ]} />
      </Row>

      <Row label="Accent" sub="lobster, or tuned down">
        <div style={{ display: 'flex', gap: 8 }}>
          <Swatch c="#FF4D14" active={tweaks.accent === 'lobster'}  onClick={() => setTweaks({ ...tweaks, accent: 'lobster' })} />
          <Swatch c="#E85A2F" active={tweaks.accent === 'warm'}      onClick={() => setTweaks({ ...tweaks, accent: 'warm' })} />
          <Swatch c="#141413" active={tweaks.accent === 'ink'}       onClick={() => setTweaks({ ...tweaks, accent: 'ink' })} />
        </div>
      </Row>

      <Row label="Editorial frames" sub="hard ink dividers on blocks">
        <Seg value={tweaks.frames ? 'on' : 'off'} onChange={v => setTweaks({ ...tweaks, frames: v === 'on' })}
          options={[{ v: 'on', l: 'on' }, { v: 'off', l: 'off' }]} />
      </Row>

      <Row label="Layout" sub="detail view arrangement">
        <Seg value={tweaks.layout} onChange={v => setTweaks({ ...tweaks, layout: v })}
          options={[{ v: 'split', l: 'split' }, { v: 'stack', l: 'stack' }]} />
      </Row>

      <div style={{ padding: '10px 14px', display: 'flex', gap: 8 }}>
        <Mono s={10} c="var(--ink-3)" style={{ flex: 1 }}>state saved to localStorage</Mono>
        <Kbd>T</Kbd>
      </div>
    </div>
  );
}

Object.assign(window, { TweaksPanel });
