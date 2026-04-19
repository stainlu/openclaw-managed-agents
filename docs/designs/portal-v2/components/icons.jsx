// Lucide-style icons, 1.5 stroke, round caps
const ICON_PATHS = {
  home: 'M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1V10',
  agents: 'M12 2l9 5v10l-9 5-9-5V7z M12 2v20 M3 7l9 5 9-5',
  env: 'M3 7h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M7 7V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2 M7 12h10',
  sessions: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6l-4 4v-4H5a2 2 0 0 1-2-2z',
  vaults: 'M6 10V7a6 6 0 0 1 12 0v3 M4 10h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z M12 15v3',
  audit: 'M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h5',
  metrics: 'M3 18v-5 M9 18v-9 M15 18v-3 M21 18V6 M3 21h18',
  docs: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20 M9 7h6 M9 11h6',
  plus: 'M12 5v14 M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  chevron: 'M6 9l6 6 6-6',
  chevronR: 'M9 6l6 6-6 6',
  copy: 'M8 2h10a2 2 0 0 1 2 2v12 M16 6H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2z',
  close: 'M18 6L6 18 M6 6l12 12',
  terminal: 'M4 17l6-6-6-6 M12 19h8',
  send: 'M5 12h14 M13 5l7 7-7 7',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3',
  dot: 'M12 12.01L12 12',
  pause: 'M6 4h4v16H6z M14 4h4v16h-4z',
  play: 'M6 3l14 9-14 9z',
  spark: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M5.6 5.6l2.8 2.8 M15.6 15.6l2.8 2.8 M5.6 18.4l2.8-2.8 M15.6 8.4l2.8-2.8',
  check: 'M4 12l5 5L20 6',
  question: 'M9 9a3 3 0 1 1 4.5 2.6c-.9.5-1.5 1.2-1.5 2.4 M12 17v0.01',
  git: 'M18 3v6 a3 3 0 0 1-3 3H9 a3 3 0 0 0-3 3v6 M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  clock: 'M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z M12 6v6l4 2',
  cpu: 'M4 7h16v10H4z M9 2v3 M15 2v3 M9 19v3 M15 19v3 M2 9h3 M2 15h3 M19 9h3 M19 15h3 M9 9h6v6H9z',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1 M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  arrowR: 'M5 12h14 M13 5l7 7-7 7',
  file: 'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M13 2v7h7',
};

function Icon({ n, s = 16, w = 1.5, style }) {
  const d = ICON_PATHS[n];
  if (!d) return null;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}>
      {d.split(' M').map((seg, i) => <path key={i} d={(i === 0 ? '' : 'M') + seg} />)}
    </svg>
  );
}

// LogoMark inline
function LogoMark({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="OpenClaw">
      <defs><linearGradient id="ocshell" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#ef6a41"/><stop offset="100%" stopColor="#d24f27"/>
      </linearGradient></defs>
      <path d="M32 10c-12 0-19 9-19 19 0 11 7 19 14 22v2a2 2 0 0 0 4 0v-1h2v1a2 2 0 0 0 4 0v-2c7-3 14-11 14-22 0-10-7-19-19-19z" fill="url(#ocshell)"/>
      <path d="M15 27c-6-2-10 1-10 5 0 5 5 7 9 5 3-1 4-4 4-6 0-2-1-3-3-4z" fill="url(#ocshell)"/>
      <path d="M49 27c6-2 10 1 10 5 0 5-5 7-9 5-3-1-4-4-4-6 0-2 1-3 3-4z" fill="url(#ocshell)"/>
      <path d="M25 14q-6-5-10-3" stroke="#e85a2f" strokeWidth="1.75" strokeLinecap="round" fill="none"/>
      <path d="M39 14q6-5 10-3" stroke="#e85a2f" strokeWidth="1.75" strokeLinecap="round" fill="none"/>
      <circle cx="26" cy="24" r="2.4" fill="#1a1613"/><circle cx="38" cy="24" r="2.4" fill="#1a1613"/>
      <circle cx="26.8" cy="23.3" r="0.8" fill="#faf7f2"/><circle cx="38.8" cy="23.3" r="0.8" fill="#faf7f2"/>
    </svg>
  );
}

Object.assign(window, { Icon, LogoMark });
