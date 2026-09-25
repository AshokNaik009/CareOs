import { aed, aedShort } from '../shared/format.js';

export default function Kpis({ contract: c, kpis: k }) {
  return (
    <div className="kpis">
      <div className="kpi"><div className="l">Members under contract</div><div className="v">{c.members.toLocaleString()}</div><div className="s">{c.cohort}</div></div>
      <div className="kpi"><div className="l">Capitation</div><div className="v">{aed(c.capitationPmpm)}</div><div className="s">per member per month · {aedShort(k.monthlyRevenue)}/mo</div></div>
      <div className="kpi"><div className="l">Medical cost PMPM</div><div className="v good">{aed(k.currentCostPmpm)}</div><div className="s">down from {aed(c.baselineCostPmpm)} before program</div></div>
      <div className="kpi"><div className="l">Medical loss ratio</div><div className="v">{k.mlr}%</div><div className="s">last 3 months</div></div>
      <div className="kpi"><div className="l">Annualized savings</div><div className="v good">{aedShort(k.annualizedSavings)}</div><div className="s">we keep the margin</div></div>
      <div className="kpi live"><div className="l">This session · AI outreach</div><div className="v">{aed(k.sessionSavings)}</div><div className="s">{k.gapsClosed} member{k.gapsClosed === 1 ? '' : 's'} closed · expected admissions avoided</div></div>
    </div>
  );
}
