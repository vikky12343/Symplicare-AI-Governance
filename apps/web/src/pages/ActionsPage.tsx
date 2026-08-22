import { useState } from 'react';
import { useActions, useCan, useCloseAction, useSelection } from '../lib/hooks.js';
import { AnswerBand, Chip, ErrorState, Field, Loading, Notice, Panel, Tag } from '../components/ui.js';
import { Bars } from '../components/charts.js';
import { BarList, Donut, Stat, StatRow, TONE_COLOUR } from '../components/stats.js';
import { ApiError, type ActionRecord } from '../lib/api.js';
import { text } from '../lib/forms.js';

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}

export function ActionsPage() {
  const { careHomeId } = useSelection();
  const can = useCan();
  const { data, isLoading, error, refetch } = useActions(careHomeId);
  const [closing, setClosing] = useState<ActionRecord | null>(null);

  if (isLoading) return <Loading label="Loading actions" />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;
  if (!data) return null;

  const { actions, today } = data;
  const open = actions.filter((a) => a.status !== 'Completed');
  const overdue = open.filter((a) => a.overdue);
  const dueSoon = open.filter((a) => !a.overdue && a.dueDate && daysBetween(today, a.dueDate) <= 14);
  const completed = actions.filter((a) => a.status === 'Completed');

  const byOwner = new Map<string, number>();
  for (const a of open) byOwner.set(a.ownerName ?? 'Unassigned', (byOwner.get(a.ownerName ?? 'Unassigned') ?? 0) + 1);

  /* How long an open action has been waiting. A median rather than a mean,
     because one action left open over a holiday would drag a mean. */
  const openAges = open
    .map((a) => (a.createdAt ? daysBetween(a.createdAt.slice(0, 10), today) : null))
    .filter((n): n is number => n !== null && Number.isFinite(n))
    .sort((x, y) => x - y);
  const medianAge = openAges.length ? (openAges[Math.floor(openAges.length / 2)] ?? null) : null;

  const byPriority = ['High', 'Medium', 'Low'].map((p2) => ({
    label: p2,
    value: open.filter((a) => a.priority === p2).length,
    tone: (p2 === 'High' ? 'bad' : p2 === 'Medium' ? 'warn' : 'plain'),
  }));

  const ownerBars = [...byOwner.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value]) => ({ label, value, tone: 'teal' as const }));

  return (
    <>
      <div className="view-head">
        <h1>Action centre</h1>
        <p>Every open, overdue, due-soon and completed action for this home.</p>
      </div>

      <StatRow>
        <Stat label="Open" value={open.length} note={`${actions.length} raised in total`} tone={open.length ? 'teal' : 'good'} />
        <Stat
          label="Overdue"
          value={overdue.length}
          note={overdue.length ? 'Past their due date' : 'Nothing late'}
          tone={overdue.length ? 'bad' : 'good'}
          meter={open.length ? overdue.length / open.length : 0}
        />
        <Stat label="Due within 14 days" value={dueSoon.length} note="Coming up" tone={dueSoon.length ? 'warn' : 'plain'} />
        <Stat
          label="Completed"
          value={completed.length}
          note={`${actions.length ? Math.round((completed.length / actions.length) * 100) : 0}% of all actions`}
          tone="good"
          meter={actions.length ? completed.length / actions.length : 0}
        />
        <Stat
          label="Median age, open"
          value={medianAge === null ? '—' : <>{medianAge}<small>days</small></>}
          note={medianAge === null ? 'Nothing open' : `across ${openAges.length} actions`}
          tone={medianAge !== null && medianAge > 60 ? 'warn' : 'plain'}
        />
      </StatRow>

      <div className="grid g-2">
        <Panel title="Open actions by priority">
          <Donut
            slices={byPriority.map((b) => ({ label: b.label, value: b.value, colour: TONE_COLOUR[b.tone] as string }))}
            caption="open"
          />
        </Panel>
        <Panel title="Open actions by owner">
          <BarList items={ownerBars} emptyLabel="No open actions to assign." />
        </Panel>
      </div>

      <AnswerBand
        tone={overdue.length ? 'bad' : open.length ? 'watch' : 'good'}
        title="What is open, and what is late?"
        meta={[`Today: ${today}`, `${completed.length} completed and closed`]}
      >
        {open.length ? (
          <>
            <b>
              {open.length} open action{open.length === 1 ? '' : 's'}
            </b>
            , of which {overdue.length} {overdue.length === 1 ? 'has' : 'have'} passed the agreed date.
            Detection without follow-through is what the source specification calls a passive dashboard, so
            every signal reviewed here ends in a recorded decision.
          </>
        ) : (
          <>Nothing is open for this home. Completed actions remain in the record with their outcome.</>
        )}
      </AnswerBand>

      <div className="kpis">
        <div className="kpi">
          <span className="k-lab">Open</span>
          <span className="k-val">{open.length}</span>
        </div>
        <div className={`kpi${overdue.length ? ' st-bad' : ' st-good'}`}>
          <span className="k-lab">Overdue</span>
          <span className="k-val">{overdue.length}</span>
          <span className="k-sub">past agreed date</span>
        </div>
        <div className="kpi">
          <span className="k-lab">Due within 14 days</span>
          <span className="k-val">{dueSoon.length}</span>
        </div>
        <div className="kpi st-good">
          <span className="k-lab">Completed</span>
          <span className="k-val">{completed.length}</span>
          <span className="k-sub">outcome recorded</span>
        </div>
      </div>

      <div className="grid g-2">
        <Panel title="Actions" flush>
          {actions.length === 0 ? (
            <div className="empty">
              No actions yet. Reviewing a signal from the Signals screen is the usual way one starts.
            </div>
          ) : (
            <div className="tbl-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Owner</th>
                    <th>Indicators</th>
                    <th>Due</th>
                    <th>Review</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {actions.map((action) => (
                    <tr key={action.id}>
                      <td>
                        <div className="ind-cell">
                          <span className="id">{action.reference}</span>
                          <span>
                            <span className="nm">{action.title}</span>
                            <div className="dm">
                              {action.priority} priority · {action.assessment}
                            </div>
                          </span>
                        </div>
                      </td>
                      <td className="small">{action.ownerName}</td>
                      <td>
                        {action.indicatorIds.map((id) => (
                          <Tag key={id}>{id}</Tag>
                        ))}
                      </td>
                      <td className="num small" style={action.overdue ? { color: 'var(--bad)' } : undefined}>
                        {action.dueDate}
                        {action.overdue && action.dueDate ? (
                          <span className="tiny"> +{daysBetween(action.dueDate, today)}d</span>
                        ) : null}
                      </td>
                      <td className="num small muted">{action.reviewDate}</td>
                      <td>
                        <Chip
                          label={action.status === 'Completed' ? (action.closure ?? 'Completed') : action.overdue ? 'Overdue' : 'Open'}
                          tone={action.status === 'Completed' ? 'good' : action.overdue ? 'bad' : 'watch'}
                        />
                      </td>
                      <td className="r">
                        {action.status !== 'Completed' && can('manageActions') ? (
                          <button type="button" className="btn btn-sm" onClick={() => setClosing(action)}>
                            Close
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="stack gap-14">
          <Panel title="Ageing of open actions">
            {open.length ? (
              <Bars
                items={open.map((a) => ({
                  label: `${a.reference} · ${(a.ownerName ?? '').split(' ')[0] ?? ''}`,
                  value: a.createdAt ? daysBetween(a.createdAt.slice(0, 10), today) : 0,
                  display: `${a.createdAt ? daysBetween(a.createdAt.slice(0, 10), today) : 0}d`,
                  tone: a.overdue ? 'bad' : 'watch',
                }))}
              />
            ) : (
              <div className="empty">Nothing open.</div>
            )}
          </Panel>

          <Panel title="Workload by owner" tools={<span className="tiny muted">Counts, not performance scores</span>}>
            {byOwner.size ? (
              <Bars items={[...byOwner].map(([owner, count]) => ({ label: owner, value: count }))} />
            ) : (
              <div className="empty">Nothing assigned.</div>
            )}
          </Panel>
        </div>
      </div>

      {completed.length ? (
        <Panel title="Closed actions and their outcomes">
          <div className="stack gap-12">
            {completed.map((action) => (
              <div key={action.id} style={{ borderBottom: '1px solid var(--line-soft)', paddingBottom: 10 }}>
                <div className="row gap-8">
                  <Chip label={action.closure ?? 'Completed'} tone={action.closure === 'False positive' ? 'none' : 'good'} />
                  <b className="small">{action.title}</b>
                  <span className="mono tiny muted">{action.reference}</span>
                </div>
                <p className="small muted" style={{ marginTop: 4 }}>
                  {action.outcome}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {closing ? <CloseDrawer action={closing} onClose={() => setClosing(null)} /> : null}
    </>
  );
}

function CloseDrawer({ action, onClose }: { action: ActionRecord; onClose: () => void }) {
  const { careHomeId } = useSelection();
  const close = useCloseAction(careHomeId);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    try {
      await close.mutateAsync({
        id: action.id,
        closure: text(form, 'closure'),
        outcome: text(form, 'outcome'),
      });
      onClose();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not close that action.');
    }
  }

  return (
    <>
      <div className="overlay on" onClick={onClose} />
      <aside className="drawer on" role="dialog" aria-modal="true" aria-label={`Close ${action.reference}`}>
        <div className="drawer-head">
          <div className="grow">
            <div className="row gap-8" style={{ marginBottom: 6 }}>
              <span className="mono tiny muted">{action.reference}</span>
            </div>
            <h2>{action.title}</h2>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="drawer-body">
          <div className="drawer-sec">
            <h3>What was agreed</h3>
            <div>
              <p className="small" style={{ color: 'var(--ink-2)' }}>
                {action.description || 'No description was recorded.'}
              </p>
              <dl className="kv" style={{ marginTop: 12 }}>
                <dt>Owner</dt>
                <dd>{action.ownerName}</dd>
                <dt>Due</dt>
                <dd>{action.dueDate}</dd>
                <dt>Review</dt>
                <dd>{action.reviewDate}</dd>
                <dt>Indicators</dt>
                <dd>
                  {action.indicatorIds.map((id) => (
                    <Tag key={id}>{id}</Tag>
                  ))}
                </dd>
              </dl>
            </div>
          </div>

          <div className="drawer-sec">
            <h3>Record the outcome</h3>
            <div>
              <form onSubmit={(e) => void submit(e)}>
                <div className="form-grid">
                  <Field label="Closure" >
                    <select name="closure" defaultValue="Resolved">
                      <option>Resolved</option>
                      <option>Ongoing</option>
                      <option>Not relevant</option>
                      <option>False positive</option>
                    </select>
                  </Field>
                  <Field label="Outcome" wide>
                    <textarea
                      name="outcome"
                      required
                      minLength={3}
                      placeholder="What was found, and what was done about it."
                    />
                  </Field>
                </div>

                <Notice>
                  A closure of <b>false positive</b> is kept deliberately. Those records are what the pilot uses
                  to tune the thresholds rather than guess at them.
                </Notice>

                {message ? (
                  <div style={{ marginTop: 12 }}>
                    <Notice variant="bad">{message}</Notice>
                  </div>
                ) : null}

                <button
                  type="submit"
                  className={`btn btn-primary btn-sm${close.isPending ? ' busy' : ''}`}
                  style={{ marginTop: 12 }}
                  disabled={close.isPending}
                >
                  Record outcome
                </button>
              </form>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
