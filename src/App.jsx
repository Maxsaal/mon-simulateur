import { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';

// ============================================================
// CALCULS FINANCIERS
// ============================================================
function pmt(rate, nper, pv) {
  if (rate === 0) return -pv / nper;
  return (-pv * rate) / (1 - Math.pow(1 + rate, -nper));
}
function fv(rate, nper, pmtVal, pv) {
  if (rate === 0) return -(pv + pmtVal * nper);
  return -(pv * Math.pow(1 + rate, nper) + pmtVal * (Math.pow(1 + rate, nper) - 1) / rate);
}

function computeModel(p) {
  const rows = [];
  const mRate = p.taux / 12;
  const totalMonths = p.dureeCredit * 12;
  const fraisNotaire = p.prix * p.tauxNotaire;
  const apportEffectif = p.apport - fraisNotaire;
  const montantEmprunte = Math.max(0, p.prix + p.travaux - apportEffectif);
  const mensualite = montantEmprunte > 0 ? -pmt(mRate, totalMonths, montantEmprunte) : 0;
  const assuranceMensuelle = (montantEmprunte * p.tauxAssurance) / 12;
  const cashResiduel = Math.max(0, p.cashTotal - p.apport);

  let portfAchat = cashResiduel;
  let portfLocInit = p.cashTotal;
  let portfLocDiff = 0;

  for (let n = 0; n <= 25; n++) {
    const valeurBien = p.prix * Math.pow(1 + p.appreciation, n);
    let crd = 0;
    if (n > 0 && n <= p.dureeCredit) crd = -fv(mRate, n * 12, -mensualite, montantEmprunte);
    else if (n === 0) crd = montantEmprunte;

    const annuiteCredit = n === 0 ? 0 : (n <= p.dureeCredit ? mensualite * 12 : 0);
    const annuiteAssur = n === 0 ? 0 : (n <= p.dureeCredit ? assuranceMensuelle * 12 : 0);
    const taxe = n === 0 ? 0 : p.taxeFonciere * Math.pow(1 + p.inflationTaxe, n - 1);
    const entretien = n === 0 ? 0 : valeurBien * p.tauxEntretien;
    const charges = n === 0 ? 0 : (p.charges + p.assuranceHabProp) * Math.pow(1 + p.inflationCharges, n - 1);
    const coutProp = annuiteCredit + annuiteAssur + taxe + entretien + charges;

    const equite = valeurBien * (1 - p.fraisAgence) - crd;
    const patrimoineAchat = equite + portfAchat;

    const loyerAnnuel = n === 0 ? 0 : p.loyer * 12 * Math.pow(1 + p.irl, n - 1);
    const assurLoc = n === 0 ? 0 : p.assuranceHabLoc * Math.pow(1 + p.inflationCharges, n - 1);
    const coutLoc = loyerAnnuel + assurLoc;
    const economie = coutProp - coutLoc;
    const investAnnuel = Math.max(0, economie) * p.discipline;
    const patrimoineLoc = portfLocInit + portfLocDiff;

    rows.push({
      annee: n, valeurBien, crd, coutProp, equite, patrimoineAchat,
      coutLoc, economie, investAnnuel, patrimoineLoc,
    });

    portfAchat *= (1 + p.rendement);
    portfLocInit *= (1 + p.rendement);
    portfLocDiff = portfLocDiff * (1 + p.rendement) + investAnnuel;
  }

  return {
    rows, fraisNotaire, montantEmprunte, mensualite,
    mensualiteTotale: mensualite + assuranceMensuelle, cashResiduel,
    ratioPrixLoyer: p.loyer > 0 ? p.prix / (p.loyer * 12) : 0,
  };
}

// ============================================================
// FORMATTERS
// ============================================================
const fmtEur = (n) => {
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)} M€`;
  if (Math.abs(n) >= 1e3) return `${Math.round(n / 1e3).toLocaleString('fr-FR')} k€`;
  return `${Math.round(n).toLocaleString('fr-FR')} €`;
};
const fmtEurFull = (n) => isFinite(n) ? `${Math.round(n).toLocaleString('fr-FR')} €` : '—';

// ============================================================
// SLIDER PARAMÈTRE
// ============================================================
function Param({ label, value, onChange, min, max, step, format, hint }) {
  return (
    <div className="param">
      <div className="param-head">
        <label>{label}</label>
        <span className="param-val">{format(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="slider"
      />
      {hint && <div className="param-hint">{hint}</div>}
    </div>
  );
}

// ============================================================
// APP
// ============================================================
export default function App() {
  const [p, setP] = useState({
    prix: 825000, apport: 300000, loyer: 2200, dureeCredit: 20, taux: 0.033,
    rendement: 0.06, discipline: 0.7,
    // avancés
    tauxNotaire: 0.08, travaux: 30000, appreciation: 0.015, fraisAgence: 0.05,
    cashTotal: 600000, tauxAssurance: 0.003, taxeFonciere: 1500, inflationTaxe: 0.03,
    tauxEntretien: 0.01, charges: 2000, assuranceHabProp: 800, inflationCharges: 0.02,
    irl: 0.015, assuranceHabLoc: 200,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSensi, setShowSensi] = useState(false);
  const [horizon, setHorizon] = useState(20);

  const set = (k) => (v) => setP((prev) => ({ ...prev, [k]: v }));
  const m = useMemo(() => computeModel(p), [p]);

  const r = m.rows[horizon];
  const verdict = r.patrimoineLoc > r.patrimoineAchat ? 'LOUER' : 'ACHETER';
  const ecart = Math.abs(r.patrimoineLoc - r.patrimoineAchat);

  const chartData = m.rows.slice(1).map((row) => ({
    annee: row.annee,
    Acheter: Math.round(row.patrimoineAchat / 1000),
    Louer: Math.round(row.patrimoineLoc / 1000),
  }));

  const disciplines = [0, 0.3, 0.5, 0.7, 1.0];
  const rendements = [0.03, 0.04, 0.05, 0.06, 0.07];
  const sensi = disciplines.map((d) =>
    rendements.map((rd) => Math.round(computeModel({ ...p, discipline: d, rendement: rd }).rows[20].patrimoineLoc / 1000))
  );
  const achat20 = Math.round(m.rows[20].patrimoineAchat / 1000);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Inter:wght@400;500;600;700&family=Roboto+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0E1B2C; }
        .app {
          --ink:#0E1B2C; --ink2:#1B2D44; --paper:#F7F5F0; --line:#D8D3C7;
          --buy:#0E7C5A; --rent:#C9622E; --muted:#6B7686; --accent:#E8B23A;
          font-family:'Inter',sans-serif; color:var(--ink); background:var(--paper);
          min-height:100vh;
        }
        .wrap { max-width:1180px; margin:0 auto; padding:0 16px; }

        /* HEADER */
        .hero { background:var(--ink); color:var(--paper); padding:36px 0 30px; }
        .hero-eyebrow { font-family:'Roboto Mono',monospace; font-size:11px; letter-spacing:.28em;
          text-transform:uppercase; color:var(--accent); margin-bottom:14px; }
        .hero h1 { font-family:'Newsreader',serif; font-weight:500; font-size:clamp(30px,6vw,52px);
          line-height:1.04; letter-spacing:-.01em; }
        .hero h1 em { font-style:italic; color:var(--accent); }
        .hero p { margin-top:14px; font-size:14px; line-height:1.6; color:#B9C2CF; max-width:560px; }

        /* LAYOUT */
        .grid { display:grid; grid-template-columns:1fr; gap:0; }
        @media(min-width:900px){ .grid { grid-template-columns:380px 1fr; } }

        /* PANNEAU PARAMÈTRES */
        .panel { background:var(--paper); padding:26px 0; }
        @media(min-width:900px){
          .panel-left { border-right:1px solid var(--line); padding-right:30px; }
          .panel-right { padding-left:30px; }
        }
        .panel-title { font-family:'Roboto Mono',monospace; font-size:11px; letter-spacing:.2em;
          text-transform:uppercase; color:var(--muted); margin-bottom:18px;
          display:flex; align-items:center; gap:8px; }
        .panel-title::before { content:''; width:18px; height:2px; background:var(--accent); }

        .param { margin-bottom:20px; }
        .param-head { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:7px; }
        .param-head label { font-size:13.5px; font-weight:500; color:var(--ink); }
        .param-val { font-family:'Roboto Mono',monospace; font-size:14px; font-weight:500;
          color:var(--ink); background:#ECE8DF; padding:2px 9px; border-radius:5px; }
        .param-hint { font-size:11px; color:var(--muted); margin-top:5px; font-style:italic; }
        .slider { -webkit-appearance:none; appearance:none; width:100%; height:4px; border-radius:4px;
          background:var(--line); outline:none; cursor:pointer; }
        .slider::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:18px; height:18px;
          border-radius:50%; background:var(--ink); border:3px solid var(--paper);
          box-shadow:0 0 0 1px var(--ink); cursor:pointer; transition:transform .1s; }
        .slider::-webkit-slider-thumb:hover { transform:scale(1.15); }
        .slider::-moz-range-thumb { width:18px; height:18px; border-radius:50%; background:var(--ink);
          border:3px solid var(--paper); box-shadow:0 0 0 1px var(--ink); cursor:pointer; }

        .disclosure { width:100%; text-align:left; background:none; border:none; cursor:pointer;
          font-family:'Roboto Mono',monospace; font-size:11px; letter-spacing:.15em; text-transform:uppercase;
          color:var(--muted); padding:14px 0; border-top:1px solid var(--line); display:flex;
          justify-content:space-between; align-items:center; }
        .disclosure:hover { color:var(--ink); }
        .disclosure .chev { transition:transform .2s; }
        .disclosure.open .chev { transform:rotate(180deg); }

        /* VERDICT */
        .verdict { padding:22px; border-radius:12px; margin-bottom:22px; color:var(--paper); }
        .verdict.buy { background:var(--buy); }
        .verdict.rent { background:var(--rent); }
        .verdict-label { font-family:'Roboto Mono',monospace; font-size:11px; letter-spacing:.2em;
          text-transform:uppercase; opacity:.8; margin-bottom:8px; }
        .verdict-main { font-family:'Newsreader',serif; font-size:38px; font-weight:600; line-height:1; }
        .verdict-sub { margin-top:10px; font-size:13.5px; opacity:.95; line-height:1.5; }

        /* HORIZON TABS */
        .horizons { display:flex; gap:6px; margin-bottom:20px; }
        .htab { flex:1; padding:9px 4px; border:1px solid var(--line); background:var(--paper);
          border-radius:8px; cursor:pointer; font-family:'Roboto Mono',monospace; font-size:12.5px;
          font-weight:500; color:var(--muted); transition:all .12s; text-align:center; }
        .htab:hover { border-color:var(--ink); }
        .htab.active { background:var(--ink); color:var(--paper); border-color:var(--ink); }

        /* STATS */
        .stats { display:grid; grid-template-columns:1fr 1fr; gap:1px; background:var(--line);
          border:1px solid var(--line); border-radius:10px; overflow:hidden; margin-bottom:22px; }
        .stat { background:var(--paper); padding:15px; }
        .stat-k { font-size:11px; color:var(--muted); margin-bottom:5px; }
        .stat-v { font-family:'Roboto Mono',monospace; font-size:17px; font-weight:500; color:var(--ink); }
        .stat-v.buy { color:var(--buy); } .stat-v.rent { color:var(--rent); }

        /* CHART */
        .chart-card { border:1px solid var(--line); border-radius:12px; padding:18px 14px 10px;
          background:var(--paper); margin-bottom:22px; }
        .chart-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;
          padding:0 4px; flex-wrap:wrap; gap:8px; }
        .chart-title { font-family:'Newsreader',serif; font-size:18px; font-weight:500; }
        .legend { display:flex; gap:14px; font-size:11.5px; }
        .legend span { display:flex; align-items:center; gap:6px; color:var(--muted); }
        .dot { width:10px; height:3px; border-radius:2px; }

        /* SENSI TABLE */
        .sensi { border:1px solid var(--line); border-radius:12px; overflow:hidden; margin-bottom:10px; }
        .sensi table { width:100%; border-collapse:collapse; font-family:'Roboto Mono',monospace; font-size:12px; }
        .sensi th, .sensi td { padding:9px 6px; text-align:center; border-bottom:1px solid var(--line); }
        .sensi th { background:#ECE8DF; font-weight:500; color:var(--ink); font-size:11px; }
        .sensi td.rowhead { background:#F0EDE5; font-weight:500; }
        .sensi td.win { color:var(--rent); font-weight:500; }
        .sensi td.lose { color:var(--muted); }
        .sensi td.here { background:var(--accent); color:var(--ink); font-weight:700; }
        .sensi-cap { font-size:11px; color:var(--muted); padding:10px 12px; background:#F0EDE5; font-style:italic; }

        /* FOOTER */
        .foot { background:var(--ink); color:#9AA6B6; padding:26px 0; font-size:11.5px; line-height:1.6; }
        .foot strong { color:var(--paper); font-weight:600; display:block; margin-bottom:6px;
          font-family:'Roboto Mono',monospace; font-size:10px; letter-spacing:.2em; text-transform:uppercase; }
        .foot a { color:var(--accent); }
      `}</style>

      <div className="app">
        {/* HERO */}
        <header className="hero">
          <div className="wrap">
            <div className="hero-eyebrow">Décision patrimoniale · simulateur</div>
            <h1>Acheter, ou louer et investir <em>?</em></h1>
            <p>Réglez vos hypothèses à gauche. Le verdict et la projection de votre patrimoine se recalculent instantanément. Deux stratégies, comparées sur 25 ans.</p>
          </div>
        </header>

        <div className="wrap">
          <div className="grid">
            {/* ===== COLONNE GAUCHE : PARAMÈTRES ===== */}
            <div className="panel panel-left">
              <div className="panel-title">Vos hypothèses</div>

              <Param label="Prix du bien" value={p.prix} onChange={set('prix')}
                min={200000} max={2000000} step={5000} format={fmtEurFull} />
              <Param label="Apport personnel" value={p.apport} onChange={set('apport')}
                min={0} max={Math.min(p.cashTotal, p.prix)} step={5000} format={fmtEurFull}
                hint={`Frais de notaire estimés : ${fmtEurFull(m.fraisNotaire)}`} />
              <Param label="Loyer actuel (mensuel)" value={p.loyer} onChange={set('loyer')}
                min={500} max={6000} step={50} format={fmtEurFull}
                hint="Le loyer que vous payez aujourd'hui" />
              <Param label="Durée du crédit" value={p.dureeCredit} onChange={set('dureeCredit')}
                min={10} max={25} step={1} format={(v) => `${v} ans`} />
              <Param label="Taux du crédit" value={p.taux} onChange={set('taux')}
                min={0.01} max={0.06} step={0.0005} format={(v) => `${(v * 100).toFixed(2)} %`}
                hint="Taux nominal annuel hors assurance" />
              <Param label="Rendement de l'épargne placée" value={p.rendement} onChange={set('rendement')}
                min={0.01} max={0.09} step={0.0025} format={(v) => `${(v * 100).toFixed(2)} %`}
                hint="Ex : ETF Monde via PEA ≈ 6-7 % nets sur long terme" />
              <Param label="Discipline d'investissement" value={p.discipline} onChange={set('discipline')}
                min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)} %`}
                hint="Part de l'économie réellement investie chaque mois" />

              {/* AVANCÉ */}
              <button className={`disclosure ${showAdvanced ? 'open' : ''}`} onClick={() => setShowAdvanced(!showAdvanced)}>
                <span>Hypothèses avancées</span>
                <span className="chev">▾</span>
              </button>
              {showAdvanced && (
                <div style={{ paddingTop: 4 }}>
                  <Param label="Frais de notaire" value={p.tauxNotaire} onChange={set('tauxNotaire')}
                    min={0.02} max={0.10} step={0.005} format={(v) => `${(v * 100).toFixed(1)} %`} />
                  <Param label="Travaux & ameublement" value={p.travaux} onChange={set('travaux')}
                    min={0} max={200000} step={5000} format={fmtEurFull} />
                  <Param label="Appréciation du bien / an" value={p.appreciation} onChange={set('appreciation')}
                    min={-0.01} max={0.05} step={0.0025} format={(v) => `${(v * 100).toFixed(2)} %`} />
                  <Param label="Frais d'agence à la revente" value={p.fraisAgence} onChange={set('fraisAgence')}
                    min={0} max={0.07} step={0.005} format={(v) => `${(v * 100).toFixed(1)} %`} />
                  <Param label="Cash total disponible" value={p.cashTotal} onChange={set('cashTotal')}
                    min={p.apport} max={1500000} step={10000} format={fmtEurFull} />
                  <Param label="Taxe foncière (an 1)" value={p.taxeFonciere} onChange={set('taxeFonciere')}
                    min={500} max={6000} step={100} format={fmtEurFull} />
                  <Param label="Entretien (% valeur / an)" value={p.tauxEntretien} onChange={set('tauxEntretien')}
                    min={0} max={0.03} step={0.0025} format={(v) => `${(v * 100).toFixed(2)} %`} />
                  <Param label="Charges + assurance (proprio)" value={p.charges} onChange={set('charges')}
                    min={0} max={6000} step={250} format={fmtEurFull} />
                  <Param label="Indexation du loyer (IRL)" value={p.irl} onChange={set('irl')}
                    min={0} max={0.04} step={0.0025} format={(v) => `${(v * 100).toFixed(2)} %`} />
                </div>
              )}
            </div>

            {/* ===== COLONNE DROITE : RÉSULTATS ===== */}
            <div className="panel panel-right">
              <div className="panel-title">Le verdict</div>

              {/* HORIZON */}
              <div className="horizons">
                {[5, 10, 15, 20, 25].map((h) => (
                  <button key={h} className={`htab ${horizon === h ? 'active' : ''}`} onClick={() => setHorizon(h)}>
                    {h} ans
                  </button>
                ))}
              </div>

              {/* VERDICT */}
              <div className={`verdict ${verdict === 'ACHETER' ? 'buy' : 'rent'}`}>
                <div className="verdict-label">À {horizon} ans, mieux vaut</div>
                <div className="verdict-main">{verdict}</div>
                <div className="verdict-sub">
                  Écart de patrimoine net : <strong>{fmtEur(ecart)}</strong> en faveur de cette stratégie.
                </div>
              </div>

              {/* STATS */}
              <div className="stats">
                <div className="stat">
                  <div className="stat-k">Patrimoine si ACHAT</div>
                  <div className="stat-v buy">{fmtEur(r.patrimoineAchat)}</div>
                </div>
                <div className="stat">
                  <div className="stat-k">Patrimoine si LOCATION</div>
                  <div className="stat-v rent">{fmtEur(r.patrimoineLoc)}</div>
                </div>
                <div className="stat">
                  <div className="stat-k">Mensualité de crédit</div>
                  <div className="stat-v">{fmtEurFull(m.mensualiteTotale)}</div>
                </div>
                <div className="stat">
                  <div className="stat-k">Ratio prix / loyer annuel</div>
                  <div className="stat-v">{m.ratioPrixLoyer.toFixed(1)}</div>
                </div>
              </div>

              {/* CHART */}
              <div className="chart-card">
                <div className="chart-head">
                  <div className="chart-title">Patrimoine net, an par an</div>
                  <div className="legend">
                    <span><i className="dot" style={{ background: 'var(--buy)' }}></i>Acheter</span>
                    <span><i className="dot" style={{ background: 'var(--rent)' }}></i>Louer + investir</span>
                  </div>
                </div>
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <LineChart data={chartData} margin={{ top: 6, right: 14, left: 6, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="#E2DDD2" vertical={false} />
                      <XAxis dataKey="annee" tick={{ fontSize: 11, fill: '#6B7686', fontFamily: 'Roboto Mono' }}
                        axisLine={{ stroke: '#D8D3C7' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#6B7686', fontFamily: 'Roboto Mono' }}
                        axisLine={false} tickLine={false}
                        tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}M` : `${v}k`} width={42} />
                      <Tooltip
                        contentStyle={{ background: '#0E1B2C', border: 'none', borderRadius: 8,
                          fontSize: 12, fontFamily: 'Inter', color: '#F7F5F0' }}
                        labelStyle={{ color: '#E8B23A', fontFamily: 'Roboto Mono', fontSize: 11 }}
                        formatter={(v, name) => [`${v.toLocaleString('fr-FR')} k€`, name]}
                        labelFormatter={(l) => `Année ${l}`} />
                      <ReferenceLine x={horizon} stroke="#E8B23A" strokeDasharray="3 3" strokeWidth={1.5} />
                      <Line type="monotone" dataKey="Acheter" stroke="#0E7C5A" strokeWidth={2.5} dot={false}
                        activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="Louer" stroke="#C9622E" strokeWidth={2.5} dot={false}
                        activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* SENSIBILITÉ */}
              <button className={`disclosure ${showSensi ? 'open' : ''}`} onClick={() => setShowSensi(!showSensi)}>
                <span>Table de sensibilité (à 20 ans)</span>
                <span className="chev">▾</span>
              </button>
              {showSensi && (
                <div className="sensi">
                  <table>
                    <thead>
                      <tr>
                        <th>Disc. ↓ / Rdt →</th>
                        {rendements.map((rd) => <th key={rd}>{(rd * 100).toFixed(0)}%</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {disciplines.map((d, i) => (
                        <tr key={d}>
                          <td className="rowhead">{(d * 100).toFixed(0)}%</td>
                          {sensi[i].map((v, j) => {
                            const isHere = d === p.discipline && rendements[j] === p.rendement;
                            const win = v > achat20;
                            return (
                              <td key={j} className={isHere ? 'here' : win ? 'win' : 'lose'}>
                                {v.toLocaleString('fr-FR')}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="sensi-cap">
                    Patrimoine LOCATION (k€) à 20 ans. En orange : la location dépasse l'achat ({fmtEur(m.rows[20].patrimoineAchat)}). En jaune : vos réglages actuels.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <footer className="foot">
          <div className="wrap">
            <strong>Outil pédagogique</strong>
            Ce simulateur est fourni à titre informatif et pédagogique uniquement. Il ne constitue ni un conseil en investissement, ni une recommandation patrimoniale ou immobilière. Les hypothèses de rendement sont déterministes et ne reflètent pas la volatilité réelle des marchés. Pour une décision personnalisée, consultez un professionnel agréé (notaire, conseiller en gestion de patrimoine, courtier).
          </div>
        </footer>
      </div>
    </>
  );
}
