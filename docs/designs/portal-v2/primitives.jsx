const { useState, useEffect, useRef } = React;

// ---- Primitives for OpenClaw Managed Agents dashboard ----

function Button({ variant = 'secondary', size = 'md', icon, iconRight, children, onClick, style, disabled }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 7,
    fontFamily: 'var(--font-sans)', fontWeight: 500,
    border: '1px solid transparent', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background 120ms var(--ease), color 120ms var(--ease), border-color 120ms var(--ease)',
    letterSpacing: '-0.011em', whiteSpace: 'nowrap',
    opacity: disabled ? 0.5 : 1,
  };
  const sizes = {
    xs: { padding: '3px 8px', fontSize: 11 },
    sm: { padding: '5px 10px', fontSize: 12 },
    md: { padding: '7px 13px', fontSize: 13 },
  };
  const variants = {
    primary: { background: 'var(--accent, var(--lobster))', color: '#fff' },
    hard: { background: 'var(--ink)', color: 'var(--paper)' },
    secondary: { background: 'var(--card)', color: 'var(--ink)', borderColor: 'var(--line-2)' },
    ghost: { background: 'transparent', color: 'var(--ink-2)' },
    danger: { background: 'var(--card)', color: 'var(--danger)', borderColor: 'var(--line-2)' },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...sizes[size], ...variants[variant], ...style }}>
      {icon && <Icon n={icon} s={size === 'xs' ? 11 : size === 'sm' ? 12 : 13} />}
      {children}
      {iconRight && <Icon n={iconRight} s={size === 'xs' ? 11 : size === 'sm' ? 12 : 13} />}
    </button>
  );
}

function Badge({ tone = 'neutral', children, dotOnly, style }) {
  const tones = {
    neutral: { bg: 'transparent', fg: 'var(--ink-2)', border: 'var(--line-2)', dot: 'var(--ink-3)' },
    ink:     { bg: 'var(--ink)', fg: 'var(--paper)', border: 'var(--ink)', dot: 'var(--paper)' },
    live:    { bg: 'var(--ink)', fg: 'var(--paper)', border: 'var(--ink)', dot: 'var(--accent, var(--lobster))' },
    ok:      { bg: 'transparent', fg: 'var(--ok)', border: 'var(--line-2)', dot: 'var(--ok)' },
    warn:    { bg: 'transparent', fg: 'var(--warn)', border: 'var(--line-2)', dot: 'var(--warn)' },
    err:     { bg: 'transparent', fg: 'var(--danger)', border: 'var(--line-2)', dot: 'var(--danger)' },
    soft:    { bg: 'var(--lobster-wash)', fg: 'var(--lobster-press)', border: 'var(--lobster-soft)', dot: 'var(--accent, var(--lobster))' },
  };
  const t = tones[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      borderRadius: 9999, padding: dotOnly ? 4 : '2px 9px',
      fontSize: 11, fontWeight: 500,
      fontFamily: 'var(--font-sans)',
      background: t.bg, color: t.fg, border: `1px solid ${t.border}`,
      lineHeight: 1.4, ...style,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: t.dot,
        boxShadow: tone === 'live' ? '0 0 0 3px color-mix(in srgb, var(--accent, var(--lobster)) 28%, transparent)' : 'none',
        animation: tone === 'live' ? 'oc-pulse 2.4s var(--ease) infinite' : 'none',
      }} />
      {!dotOnly && children}
    </span>
  );
}

const Mono = ({ children, c, s = 12, bg, style }) => (
  <span style={{
    fontFamily: 'var(--font-mono)', fontSize: s,
    color: c || 'var(--ink-2)',
    background: bg,
    padding: bg ? '2px 6px' : 0,
    borderRadius: bg ? 3 : 0,
    ...style,
  }}>{children}</span>
);

const Eyebrow = ({ children, c, style }) => (
  <span style={{
    fontFamily: 'var(--font-mono)', fontSize: 11,
    color: c || 'var(--ink-3)',
    textTransform: 'uppercase', letterSpacing: '0.04em',
    ...style,
  }}>{children}</span>
);

const Kbd = ({ children }) => (
  <span style={{
    fontFamily: 'var(--font-mono)', fontSize: 10,
    padding: '1px 5px',
    border: '1px solid var(--line-2)',
    borderRadius: 3, color: 'var(--ink-2)',
    background: 'var(--card)',
  }}>{children}</span>
);

function HardRule({ color = 'var(--ink)', margin = '0' }) {
  return <div style={{ height: 1, background: color, margin, width: '100%' }} />;
}

Object.assign(window, { Button, Badge, Mono, Eyebrow, Kbd, HardRule });
