const { useState: useStateDetail, useEffect: useEffectDetail, useRef: useRefDetail } = React;

// Event row — this is the hero of the whole design.
function EventRow({ e, streaming }) {
  const kindTone = {
    'session.status_running':  { tag: 'status', c: 'var(--ink-3)' },
    'user.message':            { tag: 'user',   c: 'var(--ink)' },
    'agent.thinking':          { tag: 'think',  c: 'var(--ink-3)' },
    'agent.message':           { tag: 'reply',  c: 'var(--ink)' },
    'agent.tool_use':          { tag: 'tool·use', c: 'var(--ink-2)' },
    'agent.tool_result':       { tag: 'tool·ok',  c: 'var(--ok)' },
    'agent.tool_confirmation_request': { tag: 'approve?', c: 'var(--lobster-press)' },
  };
  const k = kindTone[e.type] || { tag: e.type, c: 'var(--ink-3)' };

  // Shared row shell: mono timestamp + type tag + content
  const Row = ({ children, approveRow }) => (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '92px 92px 1fr',
      gap: 16,
      padding: '12px 24px',
      borderBottom: '1px solid var(--line)',
      background: approveRow ? 'var(--lobster-wash)' : 'transparent',
      borderLeft: approveRow ? '2px solid var(--accent, var(--lobster))' : '2px solid transparent',
    }}>
      <Mono s={11} c="var(--ink-3)">{e.t}</Mono>
      <div>
        <Mono s={11} c={k.c} style={{ textTransform: 'lowercase' }}>{k.tag}</Mono>
        {e.actor && (
          <div style={{ marginTop: 2 }}>
            <Mono s={10} c="var(--ink-4)">{e.actor}</Mono>
          </div>
        )}
      </div>
      <div>{children}</div>
    </div>
  );

  if (e.type === 'session.status_running') {
    return <Row><span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Container <code>oc-sx-a91c8b42</code> attached · warm-pool reuse · 4.1s boot</span></Row>;
  }
  if (e.type === 'user.message') {
    return <Row>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--ink)', lineHeight: 1.55, maxWidth: '62ch' }}>{e.text}</p>
    </Row>;
  }
  if (e.type === 'agent.thinking') {
    return <Row>
      <div style={{
        borderLeft: '1px solid var(--line-2)', paddingLeft: 12,
        fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic',
        lineHeight: 1.55, maxWidth: '62ch',
      }}>{e.text}</div>
    </Row>;
  }
  if (e.type === 'agent.tool_use') {
    return <Row>
      <div style={{
        border: '1px solid var(--line-2)', borderRadius: 6,
        padding: '8px 10px', background: 'var(--card)',
        display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10,
        alignItems: 'center',
      }}>
        <span style={{
          width: 20, height: 20, borderRadius: 4,
          background: 'var(--ink)', color: 'var(--paper)',
          display: 'grid', placeItems: 'center',
        }}>
          <Icon n="terminal" s={11} />
        </span>
        <div>
          <Mono s={12} c="var(--ink)" style={{ fontWeight: 500 }}>{e.tool}</Mono>
          <Mono s={10} c="var(--ink-3)" style={{ marginLeft: 8 }}>{e.toolUseId}</Mono>
          <div style={{ marginTop: 2, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-2)' }}>
            {JSON.stringify(e.args)}
          </div>
        </div>
        {e.needsApproval && <Badge tone="soft">pending</Badge>}
      </div>
    </Row>;
  }
  if (e.type === 'agent.tool_result') {
    return <Row>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 6,
        background: 'var(--paper-2)',
      }}>
        <Icon n="check" s={12} style={{ color: 'var(--ok)' }} />
        <Mono s={11} c="var(--ink-3)">{e.toolUseId}</Mono>
        <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{e.summary}</span>
      </div>
    </Row>;
  }
  if (e.type === 'agent.tool_confirmation_request') {
    return <Row approveRow>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge tone="soft">always_ask</Badge>
          <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>Tool approval required</span>
        </div>
        <p style={{ margin: '6px 0 10px', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, maxWidth: '58ch' }}>{e.prompt}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="hard" size="sm" icon="check">Approve</Button>
          <Button variant="secondary" size="sm">Deny</Button>
          <Button variant="ghost" size="sm">Always allow for this agent</Button>
        </div>
        <Mono s={10} c="var(--ink-3)" style={{ marginTop: 8, display: 'block' }}>
          POST /v1/sessions/sx_a91c8b42/events · user.tool_confirmation · toolUseId {e.toolUseId}
        </Mono>
      </div>
    </Row>;
  }
  return <Row>{e.type}</Row>;
}

// The streaming "agent.message" row currently being emitted token-by-token
function StreamingRow({ text }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '92px 92px 1fr',
      gap: 16,
      padding: '12px 24px',
      borderBottom: '1px solid var(--line)',
    }}>
      <Mono s={11} c="var(--ink-3)">+00:05.12…</Mono>
      <div>
        <Mono s={11} c="var(--ink)" style={{ fontWeight: 500 }}>reply</Mono>
        <div style={{ marginTop: 2 }}><Mono s={10} c="var(--ink-4)">kimi-k2.5</Mono></div>
      </div>
      <div>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--ink)', lineHeight: 1.55, maxWidth: '62ch' }}>
          <span dangerouslySetInnerHTML={{ __html: text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') }} />
          <span style={{
            display: 'inline-block', width: '0.55ch', height: 14,
            background: 'var(--ink)', verticalAlign: '-2px',
            marginLeft: 2, animation: 'oc-blink 1.1s steps(2,end) infinite',
          }} />
        </p>
        <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
          <Mono s={10} c="var(--ink-3)">↓ 128 tok</Mono>
          <Mono s={10} c="var(--ink-3)">42 tok/s</Mono>
          <Mono s={10} c="var(--ink-3)">streaming…</Mono>
        </div>
      </div>
    </div>
  );
}

function KV({ k, v, mono }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
      <Mono s={11} c="var(--ink-3)" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</Mono>
      {mono
        ? <Mono s={12} c="var(--ink)">{v}</Mono>
        : <span style={{ fontSize: 12, color: 'var(--ink)' }}>{v}</span>}
    </div>
  );
}

function SessionDetail({ sessionId, sessionState, streamLen }) {
  const s = SESSIONS.find(x => x.id === sessionId) || SESSIONS[0];
  const scrollRef = useRefDetail(null);
  useEffectDetail(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [streamLen]);

  // Derive displayed events + streaming based on state tweak
  const effectiveStatus = sessionState || s.status;
  const events = effectiveStatus === 'awaiting'
    ? EVENTS                               // stops at confirmation request
    : effectiveStatus === 'quota'
      ? EVENTS.slice(0, 3)
      : effectiveStatus === 'failed'
        ? EVENTS.slice(0, 2)
        : EVENTS.slice(0, 7);              // running: up to tool_result

  const showStream = effectiveStatus === 'running';
  const partial = STREAMING_TOKENS.slice(0, streamLen || STREAMING_TOKENS.length);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--paper)', overflow: 'hidden' }}>
      {/* Session header */}
      <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--ink)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Mono s={13} c="var(--ink)" style={{ fontWeight: 500 }}>{s.id}</Mono>
          <Icon n="copy" s={11} style={{ color: 'var(--ink-3)', cursor: 'pointer' }} />
          <Mono s={11} c="var(--ink-3)" style={{ marginLeft: 6 }}>· {s.agent} v{4} · {s.model}</Mono>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <StatusBadge s={effectiveStatus} />
            {effectiveStatus === 'running' && (
              <Button variant="secondary" size="sm" icon="pause">Cancel</Button>
            )}
            {effectiveStatus === 'awaiting' && (
              <Button variant="primary" size="sm" icon="check">Review approval</Button>
            )}
            <Button variant="ghost" size="sm" icon="external">Open JSONL</Button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 14 }}>
          <Stat label="Turns"  value={String(s.turns)} />
          <Stat label="Wall"   value={formatWall(s.wallMs)} />
          <Stat label="Tokens" value={(s.tokens/1000).toFixed(1)+'k'} meter={{v: s.tokens, cap: s.tokensCap, suffix: '/ 50k'}} />
          <Stat label="Cost"   value={'$'+s.cost.toFixed(3)} meter={{v: s.cost, cap: s.costCap, suffix: '/ $'+s.costCap.toFixed(2)}} hot={effectiveStatus==='quota'} />
          <Stat label="Container" value={s.container} mono sub={`boot ${(s.bootMs/1000).toFixed(1)}s · ${s.pool}`} />
        </div>
      </div>

      {/* Events + Inspector split */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 320px', minHeight: 0 }}>
        {/* Event stream */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: '1px solid var(--line)' }}>
          <div style={{
            padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 12,
            borderBottom: '1px solid var(--line)', background: 'var(--paper)',
          }}>
            <Eyebrow>Events · SSE</Eyebrow>
            <Mono s={10} c="var(--ink-3)">GET /v1/sessions/{s.id}/events?stream=true</Mono>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              {showStream && <>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: 'var(--accent, var(--lobster))',
                  boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent, var(--lobster)) 22%, transparent)',
                  alignSelf: 'center',
                  animation: 'oc-pulse 2s var(--ease) infinite',
                }} />
                <Mono s={10} c="var(--ink-3)">tail · 42 tok/s</Mono>
              </>}
              {!showStream && <Mono s={10} c="var(--ink-3)">paused</Mono>}
            </div>
          </div>
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }}>
            {events.map((e, i) => <EventRow key={i} e={e} />)}
            {showStream && <StreamingRow text={partial} />}
            {effectiveStatus === 'quota' && (
              <div style={{ padding: '24px', borderBottom: '1px solid var(--line)' }}>
                <Badge tone="warn">HTTP 429 · quota_exceeded</Badge>
                <p style={{ marginTop: 12, fontSize: 13, color: 'var(--ink)', maxWidth: '58ch', lineHeight: 1.55 }}>
                  Session refused further turns. <code>maxCostUsdPerSession</code> reached: $0.982 of $1.000. Open a new session on the same agent to continue, or bump the cap and retry.
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <Button variant="hard" size="sm">Raise cap to $2.00</Button>
                  <Button variant="secondary" size="sm">Open new session</Button>
                </div>
              </div>
            )}
            {effectiveStatus === 'failed' && (
              <div style={{ padding: '24px', borderBottom: '1px solid var(--line)' }}>
                <Badge tone="err">session.failed</Badge>
                <p style={{ marginTop: 12, fontSize: 13, color: 'var(--ink)', maxWidth: '58ch', lineHeight: 1.55 }}>
                  {s.error || 'Container failed to boot.'}
                </p>
              </div>
            )}
          </div>

          {/* Composer */}
          <div style={{ padding: '14px 24px 18px', borderTop: '1px solid var(--ink)' }}>
            <div style={{
              border: '1px solid var(--ink)', background: 'var(--card)',
              padding: '10px 12px', display: 'flex', alignItems: 'flex-end', gap: 10,
              opacity: effectiveStatus === 'running' || effectiveStatus === 'awaiting' ? 0.6 : 1,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '4px 2px 8px', minHeight: 24 }}>
                  {effectiveStatus === 'running' ? 'Session is running — your next message will queue.' :
                   effectiveStatus === 'awaiting' ? 'Paused on tool approval — resolve above to continue.' :
                   'Send a message to open a new turn…'}
                </div>
                <div style={{ display: 'flex', gap: 4, paddingTop: 6, borderTop: '1px solid var(--line)' }}>
                  <Mono s={10} c="var(--ink-3)" bg="var(--paper-2)">moonshot/kimi-k2.5</Mono>
                  <Mono s={10} c="var(--ink-3)" bg="var(--paper-2)">/think medium</Mono>
                  <span style={{ marginLeft: 'auto' }}><Mono s={10} c="var(--ink-3)">POST /events · <Kbd>⌘↵</Kbd></Mono></span>
                </div>
              </div>
              <button style={{
                width: 30, height: 30, borderRadius: 6,
                background: 'var(--ink)', border: 0, color: 'var(--paper)',
                display: 'grid', placeItems: 'center', cursor: 'pointer',
              }}>
                <Icon n="send" s={13} />
              </button>
            </div>
          </div>
        </div>

        {/* Inspector */}
        <SessionInspector s={s} status={effectiveStatus} />
      </div>
    </div>
  );
}

function Stat({ label, value, meter, hot, mono, sub }) {
  return (
    <div style={{ minWidth: 110 }}>
      <Eyebrow>{label}</Eyebrow>
      <div style={{
        marginTop: 3,
        fontSize: mono ? 13 : 18,
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
        fontWeight: mono ? 400 : 500,
        letterSpacing: mono ? 0 : '-0.022em',
        color: hot ? 'var(--danger)' : 'var(--ink)',
        lineHeight: 1.1,
      }}>{value}</div>
      {meter && <Meter value={meter.v} cap={meter.cap} style={{ marginTop: 6, width: 110 }} />}
      {meter && <Mono s={10} c="var(--ink-3)" style={{ marginTop: 2, display: 'block' }}>{meter.suffix}</Mono>}
      {sub && <Mono s={10} c="var(--ink-3)" style={{ marginTop: 2, display: 'block' }}>{sub}</Mono>}
    </div>
  );
}

function SessionInspector({ s, status }) {
  const [tab, setTab] = useStateDetail('config');
  return (
    <aside style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--paper)' }}>
      <div style={{
        display: 'flex', gap: 2, padding: '8px 12px 0',
        borderBottom: '1px solid var(--line)',
      }}>
        {['config', 'tree', 'raw'].map(t => {
          const active = tab === t;
          return (
            <button key={t} onClick={() => setTab(t)} style={{
              all: 'unset', cursor: 'pointer',
              padding: '8px 10px 9px',
              fontSize: 12, fontWeight: 500,
              color: active ? 'var(--ink)' : 'var(--ink-3)',
              borderBottom: active ? '2px solid var(--ink)' : '2px solid transparent',
              textTransform: 'lowercase',
            }}>
              {t === 'config' ? 'Config' : t === 'tree' ? 'Subagents' : 'Raw JSON'}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {tab === 'config' && <ConfigTab s={s} />}
        {tab === 'tree' && <TreeTab />}
        {tab === 'raw' && <RawTab s={s} />}
      </div>
    </aside>
  );
}

function ConfigTab({ s }) {
  return (
    <>
      <Eyebrow>Agent</Eyebrow>
      <div style={{ marginTop: 6 }}>
        <KV k="id"         v={s.agentId} mono />
        <KV k="name"       v={s.agent} />
        <KV k="version"    v="4 · latest" mono />
        <KV k="model"      v={s.model} mono />
      </div>

      <div style={{ height: 14 }} />
      <Eyebrow>Tools · permission</Eyebrow>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
        {['web.search', 'web.fetch', 'python'].map(t => (
          <span key={t} style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            padding: '2px 7px', border: '1px solid var(--line-2)',
            background: 'var(--card)', color: 'var(--ink-2)', borderRadius: 3,
          }}>{t} <span style={{ color: 'var(--ink-4)' }}>· allow</span></span>
        ))}
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 11,
          padding: '2px 7px', border: '1px solid var(--lobster-soft)',
          background: 'var(--lobster-wash)', color: 'var(--lobster-press)', borderRadius: 3,
        }}>file.write · ask</span>
      </div>

      <div style={{ height: 14 }} />
      <Eyebrow>MCP servers</Eyebrow>
      <div style={{ marginTop: 6 }}>
        <KV k="linear"  v="https://mcp.linear.app/sse" mono />
        <KV k="notion"  v="https://mcp.notion.so/sse" mono />
      </div>

      <div style={{ height: 14 }} />
      <Eyebrow>Environment</Eyebrow>
      <div style={{ marginTop: 6 }}>
        <KV k="id"          v={s.env} mono />
        <KV k="networking"  v="unrestricted" />
        <KV k="pip"         v="requests, httpx" mono />
      </div>

      <div style={{ height: 14 }} />
      <Eyebrow>Quota</Eyebrow>
      <div style={{ marginTop: 6 }}>
        <KV k="maxCost"   v="$1.00 / session" mono />
        <KV k="maxTokens" v="50,000 / session" mono />
        <KV k="maxWall"   v="30 min" mono />
      </div>
    </>
  );
}

function TreeTab() {
  const tree = [
    { depth: 0, id: 'sx_a91c8b42', name: 'research-assistant', status: 'running', tokens: '8.4k', cost: '$0.063' },
    { depth: 1, id: 'sx_child_01', name: 'web-analyzer',        status: 'running', tokens: '2.1k', cost: '$0.019' },
    { depth: 2, id: 'sx_child_02', name: 'fact-check',          status: 'ended',   tokens: '0.8k', cost: '$0.004' },
    { depth: 1, id: 'sx_child_03', name: 'doc-writer',          status: 'idle',    tokens: '0',    cost: '$0.000' },
  ];
  return (
    <>
      <Eyebrow>Delegation tree · depth 2 / 3</Eyebrow>
      <div style={{ marginTop: 10 }}>
        {tree.map((n, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '1fr auto auto',
            alignItems: 'center', gap: 8,
            padding: '8px 0', paddingLeft: n.depth * 16,
            borderBottom: '1px solid var(--line)',
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {n.depth > 0 && <span style={{ color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>└─</span>}
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>{n.name}</span>
              </div>
              <Mono s={10} c="var(--ink-3)">{n.id}</Mono>
            </div>
            <StatusBadge s={n.status} />
            <Mono s={10} c="var(--ink-2)">{n.cost}</Mono>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
        Children are first-class sessions. Inspect any of them through the same API — transcripts are never hidden behind opaque tool results.
      </p>
    </>
  );
}

function RawTab({ s }) {
  const json = {
    session_id: s.id,
    agent_id: s.agentId,
    status: s.status,
    model: s.model,
    tokens_in: 6_140, tokens_out: 2_272,
    cost_usd: s.cost,
    turns: s.turns,
    container: s.container,
    environment_id: s.env,
    last_event_id: 'evt_000042',
  };
  return (
    <pre style={{
      margin: 0, fontSize: 11, lineHeight: 1.55,
      background: 'var(--paper-2)', border: '1px solid var(--line)',
      padding: 12, borderRadius: 4, color: 'var(--ink)',
      whiteSpace: 'pre-wrap',
    }}>{JSON.stringify(json, null, 2)}</pre>
  );
}

function formatWall(ms) {
  const s = Math.floor(ms/1000);
  if (s < 60) return s+'s';
  const m = Math.floor(s/60);
  if (m < 60) return m+'m '+(s%60)+'s';
  const h = Math.floor(m/60);
  return h+'h '+(m%60)+'m';
}

Object.assign(window, { SessionDetail });
