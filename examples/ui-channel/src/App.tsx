/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The page: ops in over the ui channel's WebSocket (`useUiSocket`), displays
 * out through `ReactorDisplay`, presses back up the socket with the offered
 * token, each answered with the registry's status.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { buildReactorFromPlugins } from '../../../src';
import { useReactor } from '../../../src/react';
import { orderedDisplays, resolveToolResult, type Display, type UiAct } from '../../../src/ui';
import { ReactorDisplay, useUiSocket } from '../../../src/react/ui';
import { SESSION, SOCKET, readModelView, requestApproval } from './api';
import { ApprovalsPlugin } from './approvalPlugin';

const PEOPLE = ['grace', 'ada'];

/** A chat's tool call, as a host hands it over: drawn through the plugin's binding. */
const TOOL_CALL = {
  toolName: 'mcp.request_approval',
  toolCallId: 'call-1',
  result: { title: 'Conference ticket', amount_eur: 420, requester: 'ada', status: 'pending' },
};

/** A display no plugin draws: the page shows its text. */
const UNCLAIMED: Display = {
  type: 'application/vnd.reactor-example.receipt+json',
  id: 'receipt-1',
  text: 'Receipt #1: 64.50 EUR, paid',
};

export function App() {
  const [principal, setPrincipal] = useState(PEOPLE[0]);
  // One connection per person: their name is the credential the hello carries.
  return <Desk key={principal} principal={principal} setPrincipal={setPrincipal} />;
}

function Desk({ principal, setPrincipal }: { principal: string; setPrincipal: (person: string) => void }) {
  const reactor = useMemo(() => buildReactorFromPlugins([ApprovalsPlugin]), []);
  useReactor(reactor);

  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [told, setTold] = useState<unknown>();
  const { model, status, reason, act } = useUiSocket({
    url: SOCKET,
    scope: SESSION,
    token: () => principal,
    onWindow: (op) => setNotice(String(op.body.args?.message ?? op.body.name)),
  });

  useEffect(() => {
    readModelView().then(setTold, () => undefined);
  }, [model]);

  /** How a renderer presses: the host adds the display and the token it was offered. */
  const actOn =
    (display: Display): UiAct =>
    async (action) => {
      const offer = display.actions?.find((candidate) => candidate.name === action.action);
      if (!offer) {
        setError(`${display.id} does not offer ${action.action}`);
        return;
      }
      try {
        setError(undefined);
        const result = await act({ ...action, display_id: display.id, token: offer.token });
        if (!result.ok) {
          setError(`${result.status}: ${result.detail ?? ''}`);
        }
        return result.value;
      } catch (failure) {
        setError(String(failure));
      }
    };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      setError(undefined);
      await requestApproval({
        title: String(form.get('title')),
        amount_eur: Number(form.get('amount')),
        requester: String(form.get('requester')),
        reviewer_note: String(form.get('note') ?? ''),
      });
    } catch (failure) {
      setError(String(failure));
    }
  };

  const toolDisplay = resolveToolResult(reactor, TOOL_CALL);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 16, maxWidth: 1040, margin: '0 auto' }}>
      <h1>{String(model.meta.title ?? 'reactor.ui')}</h1>

      <form onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input name="title" placeholder="What" defaultValue="Monitor" required />
        <input name="amount" type="number" step="0.01" defaultValue="320" required style={{ width: 96 }} />
        <select name="requester" defaultValue="ada">
          {PEOPLE.map((person) => (
            <option key={person}>{person}</option>
          ))}
        </select>
        <input name="note" placeholder="Note for the reviewer (page only)" />
        <button type="submit">Request approval</button>
      </form>

      <p>
        Pressing as{' '}
        <select value={principal} onChange={(event) => setPrincipal(event.target.value)}>
          {PEOPLE.map((person) => (
            <option key={person}>{person}</option>
          ))}
        </select>{' '}
        — a requester deciding their own request is vetoed (403).
      </p>
      <p>
        Socket: {status}
        {reason ? ` (${reason})` : ''}
      </p>
      {notice ? <p role="status">Window: {notice}</p> : null}
      {error ? <p role="alert" style={{ color: '#cf222e' }}>{error}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <section>
          <h2>The session</h2>
          {orderedDisplays(model).map((display) => (
            <ReactorDisplay key={display.id} display={display} act={actOn(display)} loading="Loading…" />
          ))}
          <h2>A tool result</h2>
          {toolDisplay ? <ReactorDisplay display={toolDisplay} context={TOOL_CALL} /> : null}
          <h2>No renderer</h2>
          <ReactorDisplay display={UNCLAIMED} />
        </section>
        <section>
          <h2>What a model is told</h2>
          <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(told, null, 2)}</pre>
          <h2>Shared state</h2>
          <pre style={{ fontSize: 12 }}>{JSON.stringify(model.state, null, 2)}</pre>
        </section>
      </div>
    </main>
  );
}
