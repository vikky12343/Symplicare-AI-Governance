import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fmtUnit, STATUS_ORDER, type Indicator } from '@cgi/core';
import { useDashboard, useDictionary, useSelection } from '../lib/hooks.js';
import { AnswerBand, ErrorState, Loading, Notice, Panel, StatusChip, Tag } from '../components/ui.js';
import { BarList, Stat, StatRow } from '../components/stats.js';
import { Sparkline } from '../components/charts.js';

export function IndicatorsPage() {
  const { careHomeId, period } = useSelection();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const dashboard = useDashboard(careHomeId, period);
  const dictionary = useDictionary();
  const [search, setSearch] = useState('');

  const statusFilter = params.get('status') ?? 'All';
  const domainFilter = params.get('domain') ?? 'All';
  const typeFilter = params.get('type') ?? 'All';

  const rows = useMemo(() => {
    const indicators = dashboard.data?.indicators ?? [];
    const definitions = new Map((dictionary.data?.indicators ?? []).map((i) => [i.id, i]));
    return indicators
      .map((e) => ({ evaluation: e, definition: definitions.get(e.indicatorId) }))
      .filter(({ evaluation, definition }) => {
        if (statusFilter !== 'All' && evaluation.status !== statusFilter) return false;
        if (domainFilter !== 'All' && evaluation.indicator.domain !== domainFilter) return false;
        if (typeFilter !== 'All' && evaluation.indicator.type !== typeFilter) return false;
        if (search) {
          const haystack = `${evaluation.indicatorId} ${evaluation.indicator.name} ${definition?.calc ?? ''}`.toLowerCase();
          if (!haystack.includes(search.toLowerCase())) return false;
        }
        return true;
      });
  }, [dashboard.data, dictionary.data, statusFilter, domainFilter, typeFilter, search]);

  if (dashboard.isLoading || dictionary.isLoading) return <Loading label="Loading the indicator library" />;
  if (dashboard.error) return <ErrorState error={dashboard.error} retry={() => void dashboard.refetch()} />;
  if (!dashboard.data || !dictionary.data) return null;

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'All') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const all = dashboard.data.indicators;
  const countOf = (status: string) => all.filter((i) => i.status === status).length;
  const byDomain = [...new Set(all.map((i) => i.indicator?.domain).filter(Boolean))].map((domain) => ({
    label: domain,
    value: all.filter((i) => i.indicator?.domain === domain && (i.status === 'Deteriorating' || i.status === 'Watch')).length,
    tone: 'warn' as const,
    onClick: () => setFilter('domain', domain === domainFilter ? 'All' : (domain)),
  }));
  const readable = all.length - countOf('Insufficient data');

  return (
    <>
      <div className="view-head">
        <h1>Indicator library</h1>
        <p>The controlled set of fifteen, with the definitions exactly as supplied.</p>
      </div>

      <StatRow>
        <Stat
          label="Deteriorating"
          value={countOf('Deteriorating')}
          note="Two tests agree"
          tone={countOf('Deteriorating') ? 'bad' : 'good'}
          onClick={() => setFilter('status', statusFilter === 'Deteriorating' ? 'All' : 'Deteriorating')}
        />
        <Stat
          label="On watch"
          value={countOf('Watch')}
          note="One test only"
          tone={countOf('Watch') ? 'warn' : 'plain'}
          onClick={() => setFilter('status', statusFilter === 'Watch' ? 'All' : 'Watch')}
        />
        <Stat
          label="Stable"
          value={countOf('Stable')}
          note="Inside the normal range"
          tone="plain"
          onClick={() => setFilter('status', statusFilter === 'Stable' ? 'All' : 'Stable')}
        />
        <Stat
          label="Improving"
          value={countOf('Improving')}
          note="Moving the helpful way"
          tone="good"
          onClick={() => setFilter('status', statusFilter === 'Improving' ? 'All' : 'Improving')}
        />
        <Stat
          label="Cannot be read"
          value={countOf('Insufficient data')}
          note={`${readable} of ${all.length} readable`}
          tone={countOf('Insufficient data') ? 'info' : 'good'}
          onClick={() => setFilter('status', statusFilter === 'Insufficient data' ? 'All' : 'Insufficient data')}
        />
      </StatRow>

      <Panel title="Where attention is needed, by domain">
        <BarList items={byDomain} emptyLabel="No domain currently has an indicator outside its normal range." />
      </Panel>

      <AnswerBand
        tone="good"
        title="The controlled indicator library"
        meta={[
          `${rows.length} of ${dashboard.data.indicators.length} shown`,
          'Direction of harm is per indicator, not assumed uniform',
        ]}
      >
        Fifteen indicators, each with one definition. Calculation, unit, cadence, source, missing-data rule and
        direction of harm are carried through from the source data dictionary unchanged — the tracker reads
        those fields, it does not reinterpret them.
      </AnswerBand>

      <div className="row gap-8 wrap" style={{ marginBottom: 14 }}>
        <input
          className="search"
          placeholder="Search indicators…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select" value={domainFilter} onChange={(e) => setFilter('domain', e.target.value)}>
          <option>All</option>
          {dictionary.data.domains.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select className="select" value={typeFilter} onChange={(e) => setFilter('type', e.target.value)}>
          <option>All</option>
          <option>Potential leading</option>
          <option>Lagging</option>
          <option>Outcome</option>
          <option>Lagging/context</option>
        </select>
        <select className="select" value={statusFilter} onChange={(e) => setFilter('status', e.target.value)}>
          <option>All</option>
          {STATUS_ORDER.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>

      <Panel flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Indicator</th>
                <th>Domain</th>
                <th>Type</th>
                <th>Cadence</th>
                <th>Direction of harm</th>
                <th className="r">Current</th>
                <th>12-month</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty">No indicator matches these filters.</div>
                  </td>
                </tr>
              ) : (
                rows.map(({ evaluation, definition }) => (
                  <tr
                    key={evaluation.indicatorId}
                    className="tap"
                    onClick={() => void navigate(`/indicators/${evaluation.indicatorId}`)}
                  >
                    <td>
                      <div className="ind-cell">
                        <span className="id">{evaluation.indicatorId}</span>
                        <span className="nm">{evaluation.indicator.name}</span>
                      </div>
                      <div className="tiny muted" style={{ maxWidth: '44ch' }}>
                        {definition?.calc}
                      </div>
                    </td>
                    <td className="small">{evaluation.indicator.domain}</td>
                    <td>
                      <Tag>{evaluation.indicator.type}</Tag>
                    </td>
                    <td className="small muted">{definition?.period}</td>
                    <td className="small">{evaluation.indicator.harm}</td>
                    <td className="r num">
                      {evaluation.value === null ? (
                        <span className="muted">—</span>
                      ) : (
                        fmtUnit(evaluation.value, evaluation.indicator as Indicator)
                      )}
                    </td>
                    <td>
                      <Sparkline readings={evaluation.sparkline} status={evaluation.status} />
                    </td>
                    <td>
                      <StatusChip status={evaluation.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <div style={{ marginTop: 14 }}>
        <Notice>
          <b>How the leading and lagging distinction is used.</b> The <i>Type</i> field is taken from the
          dictionary as supplied and is never relabelled here. Potential leading indicators describe developing
          organisational conditions. Lagging indicators describe outcomes that have already become visible; they
          stay on screen for learning, accountability and context, but an incident rate on its own is never
          presented as a predictor of a future incident.
        </Notice>
      </div>
    </>
  );
}
