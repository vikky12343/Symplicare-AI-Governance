import { useState } from 'react';
import { fmtBase, fmtSigned, fmtUnit, parsePeriod, type Indicator } from '@cgi/core';
import { useCan, useCreateAction, useDashboard, useSelection, useSignalTimeline } from '../lib/hooks.js';
import { AnswerBand, ErrorState, Field, Loading, Notice, Panel, StatusChip, Tag } from '../components/ui.js';
import { Sparkline } from '../components/charts.js';
import { Stat, StatRow } from '../components/stats.js';
import type { DashboardSignal, IndicatorEvaluation } from '../lib/api.js';
import { ApiError } from '../lib/api.js';
import { text } from '../lib/forms.js';

export function SignalsPage() {
  const { careHomeId, period } = useSelection();
  const { data, isLoading, error, refetch } = useDashboard(careHomeId, period);
  const timeline = useSignalTimeline(careHomeId, period);
  const [respondingTo, setRespondingTo] = useState<DashboardSignal | null>(null);

  if (isLoading) return <Loading label="Loading signals" />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;
  if (!data) return null;

  const raised = data.signals.filter((s) => s.raised);
  const deteriorating = raised.filter((s) => s.severity === 'Deteriorating');
  const watching = raised.filter((s) => s.severity === 'Watch');
  const contributing = new Set(raised.flatMap((s) => s.harmful));
  const earliest = raised
    .map((s) => s.firstRaisedPeriod)
    .filter((p): p is string => Boolean(p))
    .sort()[0];

  return (
    <>
      <div className="view-head">
        <h1>Signals and patterns</h1>
        <p>Related indicators judged together, with the evidence each pattern was built from.</p>
      </div>

      <StatRow>
        <Stat
          label="Patterns raised"
          value={raised.length}
          note={`of ${data.signals.length} tested`}
          tone={raised.length ? 'warn' : 'good'}
          meter={data.signals.length ? raised.length / data.signals.length : 0}
        />
        <Stat
          label="Deteriorating"
          value={deteriorating.length}
          note={deteriorating.length ? 'Two tests agree' : 'None called'}
          tone={deteriorating.length ? 'bad' : 'good'}
        />
        <Stat label="On watch" value={watching.length} note="One test only" tone={watching.length ? 'warn' : 'plain'} />
        <Stat
          label="Indicators contributing"
          value={contributing.size}
          note={`of ${data.indicators.length} in the library`}
          tone="teal"
          meter={data.indicators.length ? contributing.size / data.indicators.length : 0}
        />
        <Stat
          label="Earliest raised"
          value={earliest ? parsePeriod(earliest).label : '—'}
          note={earliest ? 'First met its rule' : 'Nothing raised yet'}
          tone="plain"
        />
      </StatRow>

      <AnswerBand
        tone={raised.length ? (data.signals[0]?.severity === 'Deteriorating' ? 'bad' : 'watch') : 'good'}
        title="What is moving together?"
        meta={[
          `Convergence threshold: ${data.rules.convergeMin} related indicators`,
          `Sustained trend: ${data.rules.runDeteriorate} consecutive periods`,
          `Outside normal range: ${data.rules.bandSigma}× spread`,
        ]}
      >
        {raised.length ? (
          <>
            <b>
              {raised.length} of {data.signals.length} tested patterns
            </b>{' '}
            currently meet their rule for {data.periodLabel}. A pattern is raised when {data.rules.convergeMin} or
            more related indicators move in the harmful direction together, or when one of them deteriorates on
            its own.
          </>
        ) : (
          <>No pattern currently meets its rule. Each group is still listed below with the evidence tested.</>
        )}
      </AnswerBand>

      <div style={{ marginBottom: 14 }}>
        <Notice variant="brand">
          <b>These are review prompts, not predictions.</b> Nothing here states that an incident will occur, that
          a home is unsafe, or what a regulator would conclude. Each signal shows the indicators, periods and
          baseline it was built from so the judgement stays with the manager.
        </Notice>
      </div>

      {data.signals.map((signal) => (
        <SignalCard key={signal.id} signal={signal} onRespond={() => setRespondingTo(signal)} />
      ))}

      <Panel
        title="Signal timeline"
        tools={<span className="tiny muted">Replayed by running the same rules at every past period</span>}
      >
        {timeline.data?.events.length ? (
          <div className="timeline">
            {timeline.data.events.map((event) => (
              <div
                key={`${event.signalId}-${event.period}-${event.kind}`}
                className={`tl-item st-${event.kind === 'raised' ? 'bad' : 'good'}`}
              >
                <div className="tl-when">{event.period}</div>
                <h4>{event.title}</h4>
                <p>
                  {event.kind === 'raised'
                    ? 'Rule first met — pattern raised for review.'
                    : 'Rule no longer met — pattern cleared.'}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">No signal has been raised or cleared in this home's recorded history.</div>
        )}
      </Panel>

      {respondingTo ? (
        <ResponseDrawer signal={respondingTo} period={data.period} onClose={() => setRespondingTo(null)} />
      ) : null}
    </>
  );
}

function SignalCard({ signal, onRespond }: { signal: DashboardSignal; onRespond: () => void }) {
  const can = useCan();
  const tone = signal.severity === 'Deteriorating' ? 'bad' : signal.severity === 'Watch' ? 'watch' : 'stable';

  return (
    <article className={`signal st-${tone}`}>
      <div className="row gap-8 wrap">
        <StatusChip status={signal.severity} />
        <Tag brand>{signal.kind}</Tag>
        {signal.converged ? <Tag>Convergence rule met</Tag> : null}
        {signal.mixed ? <Tag>Mixed evidence</Tag> : null}
        {signal.firstRaisedPeriod ? <Tag>First raised {signal.firstRaisedPeriod}</Tag> : null}
        <span className="grow" />
        <span className="mono tiny muted">{signal.id}</span>
      </div>

      <h3>{signal.title}</h3>
      <p>{signal.narrative}</p>

      <div className="contrib">
        {signal.members.map((member) => (
          <span className="contrib-item" key={member.indicatorId}>
            <span className="mono tiny" style={{ color: 'var(--faint)' }}>
              {member.indicatorId}
            </span>
            {member.indicator.short}
            <Sparkline readings={member.sparkline} status={member.status} />
            <span className="num tiny">
              {member.value === null ? '—' : fmtUnit(member.value, member.indicator as Indicator)}
            </span>
            <StatusChip status={member.status} />
          </span>
        ))}
      </div>

      {signal.raised && can('manageActions') ? (
        <div className="row gap-8 wrap">
          <button type="button" className="btn btn-sm btn-primary" onClick={onRespond}>
            Record management response
          </button>
        </div>
      ) : null}
    </article>
  );
}

/**
 * Recording the response is what turns detection into a governance record.
 * "False positive" is a first-class outcome here — the pilot needs those to
 * tune the thresholds.
 */
function ResponseDrawer({
  signal,
  period,
  onClose,
}: {
  signal: DashboardSignal;
  period: string;
  onClose: () => void;
}) {
  const { careHomeId } = useSelection();
  const createAction = useCreateAction(careHomeId);
  const [message, setMessage] = useState<string | null>(null);

  const harmful = signal.members.filter((m) => signal.harmful.includes(m.indicatorId));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    try {
      await createAction.mutateAsync({
        title: text(form, 'title'),
        description: text(form, 'description'),
        signalId: signal.id,
        indicatorIds: signal.harmful,
        priority: text(form, 'priority'),
        assessment: text(form, 'assessment'),
        dueDate: text(form, 'dueDate'),
        reviewDate: text(form, 'reviewDate'),
      });
      onClose();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not save that action.');
    }
  }

  const today = new Date();
  const inDays = (n: number) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);

  return (
    <>
      <div className="overlay on" onClick={onClose} />
      <aside className="drawer on" role="dialog" aria-modal="true" aria-label={signal.title}>
        <div className="drawer-head">
          <div className="grow">
            <div className="row gap-8 wrap" style={{ marginBottom: 6 }}>
              <StatusChip status={signal.severity} />
              <Tag brand>{signal.kind}</Tag>
              <span className="mono tiny muted">{signal.id}</span>
            </div>
            <h2>{signal.title}</h2>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="drawer-body">
          <Notice variant="brand">
            This is a prompt for governance review built from this home's own history. It is not a prediction,
            and it does not state that the service is unsafe.
          </Notice>

          <div className="drawer-sec">
            <h3>Why it was raised</h3>
            <div>
              <p className="small" style={{ color: 'var(--ink-2)' }}>
                {signal.narrative}
              </p>
            </div>
          </div>

          <div className="drawer-sec">
            <h3>Evidence</h3>
            <div>
              {harmful.map((member) => (
                <Evidence key={member.indicatorId} member={member} />
              ))}
            </div>
          </div>

          <div className="drawer-sec">
            <h3>Record the management response</h3>
            <div>
              <form onSubmit={(e) => void submit(e)}>
                <div className="form-grid">
                  <Field label="Assessment">
                    <select name="assessment" defaultValue="Confirmed concern">
                      <option>Requires review</option>
                      <option>Confirmed concern</option>
                      <option>Explained by known context</option>
                      <option>Not relevant</option>
                      <option>False positive</option>
                    </select>
                  </Field>
                  <Field label="Priority">
                    <select name="priority" defaultValue="High">
                      <option>High</option>
                      <option>Medium</option>
                      <option>Low</option>
                    </select>
                  </Field>
                  <Field label="Action required" wide>
                    <input
                      name="title"
                      required
                      minLength={3}
                      defaultValue={`Review ${harmful.map((m) => m.indicator.short.toLowerCase()).join(', ')}`}
                    />
                  </Field>
                  <Field label="What was found, and what happens next" wide>
                    <textarea
                      name="description"
                      placeholder="For example: confirm agency and absence against the rota system, then report back to the governance meeting."
                    />
                  </Field>
                  <Field label="Due date">
                    <input name="dueDate" type="date" defaultValue={inDays(21)} required />
                  </Field>
                  <Field label="Review date">
                    <input name="reviewDate" type="date" defaultValue={inDays(51)} required />
                  </Field>
                </div>

                {message ? (
                  <div style={{ marginTop: 12 }}>
                    <Notice variant="bad">{message}</Notice>
                  </div>
                ) : null}

                <div className="row gap-8" style={{ marginTop: 12 }}>
                  <button
                    type="submit"
                    className={`btn btn-primary btn-sm${createAction.isPending ? ' busy' : ''}`}
                    disabled={createAction.isPending}
                  >
                    Save and assign
                  </button>
                  <span className="tiny muted">Recorded against {period} in the audit log.</span>
                </div>
              </form>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function Evidence({ member }: { member: IndicatorEvaluation }) {
  const indicator = member.indicator as Indicator;
  return (
    <div style={{ padding: '11px 0', borderTop: '1px solid var(--line-soft)' }}>
      <div className="row gap-8" style={{ justifyContent: 'space-between' }}>
        <span className="small">
          <span className="mono tiny" style={{ color: 'var(--faint)' }}>
            {member.indicatorId}
          </span>{' '}
          <b>{member.indicator.name}</b>
        </span>
        <StatusChip status={member.status} />
      </div>
      {member.value === null ? (
        <p className="tiny muted" style={{ marginTop: 6 }}>
          {member.why}
        </p>
      ) : (
        <>
          <div className="row gap-16 wrap" style={{ margin: '7px 0' }}>
            <span className="tiny muted">
              now{' '}
              <b className="num" style={{ color: 'var(--ink)', fontSize: 13 }}>
                {fmtUnit(member.value, indicator)}
              </b>
            </span>
            <span className="tiny muted">
              baseline <b className="num" style={{ color: 'var(--ink)' }}>{fmtBase(member.baseline, indicator)}</b>
            </span>
            <span className="tiny muted">
              change <b className="num" style={{ color: 'var(--ink)' }}>{fmtSigned(member.changePct, 0)}%</b>
            </span>
            <span className="tiny muted">
              run{' '}
              <b className="num" style={{ color: 'var(--ink)' }}>
                {member.harmfulRun || member.helpfulRun || 0}
              </b>
            </span>
          </div>
          <div className="tests">
            {member.reasons.map((reason, i) => (
              <div className="test" key={i}>
                <span className="t-name">{reason.test}</span>
                <span className="t-body">{reason.text}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
