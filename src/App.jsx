import { useState, useMemo, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';

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

  // Logique simple : coût total du projet − apport = montant emprunté
  const coutTotalProjet = p.prix + fraisNotaire + p.travaux;
  const montantEmprunte = Math.max(0, coutTotalProjet - p.apport);

  const mensualiteCredit = montantEmprunte > 0 ? -pmt(mRate, totalMonths, montantEmprunte) : 0;
  const assuranceMensuelle = (montantEmprunte * p.tauxAssurance) / 12;
  const mensualiteTotale = mensualiteCredit + assuranceMensuelle;

  // À mise de départ égale : côté location, on investit l'équivalent de l'apport
  // (la somme que l'acheteur immobilise dans le bien). Côté achat, pas de poche
  // de cash résiduel : tout cash au-delà de l'apport serait géré identiquement
  // dans les deux scénarios et s'annulerait dans la comparaison.
  let portfAchat = 0;
  let portfLocInit = p.apport;
  let portfLocDiff = 0;
  let crdPrec = montantEmprunte;

  for (let n = 0; n <= 25; n++) {
    const valeurBien = p.prix * Math.pow(1 + p.appreciation, n);
    let crd = 0;
    if (n > 0 && n <= p.dureeCredit) crd = -fv(mRate, n * 12, -mensualiteCredit, montantEmprunte);
    else if (n === 0) crd = montantEmprunte;
    else crd = 0;

    const annuiteCredit = n === 0 ? 0 : (n <= p.dureeCredit ? mensualiteCredit * 12 : 0);
    const annuiteAssur = n === 0 ? 0 : (n <= p.dureeCredit ? assuranceMensuelle * 12 : 0);
    const capitalRembourse = n === 0 ? 0 : Math.max(0, crdPrec - crd);
    const interets = Math.max(0, annuiteCredit - capitalRembourse);
    crdPrec = crd;

    const taxe = n === 0 ? 0 : p.taxeFonciere * Math.pow(1 + p.inflationTaxe, n - 1);
    const entretien = n === 0 ? 0 : valeurBien * p.tauxEntretien;
    const chargesProp = n === 0 ? 0 : p.chargesProp * Math.pow(1 + p.inflationCharges, n - 1);

    const coutReelAchat = interets + annuiteAssur + taxe + entretien + chargesProp;
    const decaissementAchat = annuiteCredit + annuiteAssur + taxe + entretien + chargesProp;

    const loyerAnnuel = n === 0 ? 0 : p.loyer * 12 * Math.pow(1 + p.irl, n - 1);
    const coutReelLoc = loyerAnnuel;

    const ecartDecaissement = decaissementAchat - loyerAnnuel;
    const investAnnuel = Math.max(0, ecartDecaissement) * p.discipline;

    const equite = valeurBien * (1 - p.decoteRevente) - crd;
    const patrimoineAchat = equite + portfAchat;
    const patrimoineLoc = portfLocInit + portfLocDiff;

    rows.push({
      annee: n, valeurBien, crd, equite, patrimoineAchat, patrimoineLoc,
      interets, annuiteAssur, taxe, entretien, chargesProp, capitalRembourse,
      coutReelAchat, decaissementAchat, loyerAnnuel, coutReelLoc,
      ecartDecaissement, investAnnuel,
    });

    portfAchat *= (1 + p.rendement);
    portfLocInit *= (1 + p.rendement);
    portfLocDiff = portfLocDiff * (1 + p.rendement) + investAnnuel;
  }

  return {
    rows, fraisNotaire, montantEmprunte, mensualiteCredit, assuranceMensuelle, mensualiteTotale,
    cashResiduel: 0, coutTotalProjet,
    ratioPrixLoyer: p.loyer > 0 ? p.prix / (p.loyer * 12) : 0,
  };
}

const fmtEur = (n) => {
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)} M€`;
  if (Math.abs(n) >= 1e3) return `${Math.round(n / 1e3).toLocaleString('fr-FR')} k€`;
  return `${Math.round(n).toLocaleString('fr-FR')} €`;
};
const fmtEurFull = (n) => isFinite(n) ? `${Math.round(n).toLocaleString('fr-FR')} €` : '—';

const DEFAULTS = {
  prix: 300000, apport: 60000, loyer: 1250, dureeCredit: 20, taux: 0.033, tauxAssurance: 0.003,
  rendement: 0.05, discipline: 0.7, revenusFoyer: 5000,
  tauxNotaire: 0.08, travaux: 10000, appreciation: 0.02, decoteRevente: 0.05,
  taxeFonciere: 1200, inflationTaxe: 0.02,
  tauxEntretien: 0.01, chargesProp: 600, inflationCharges: 0.02, irl: 0.02,
};
const STORAGE_KEY = 'simulateur-rp-v4';

function Info({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span className="info-wrap"
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
      onClick={(e) => { e.preventDefault(); setShow(!show); }}>
      <span className="info-dot">i</span>
      {show && <span className="info-bubble">{text}</span>}
    </span>
  );
}

function Param({ label, value, onChange, min, max, step, format, hint, info, unit }) {
  // champ de saisie : on édite la valeur "humaine" (ex: euros, ou % ×100)
  const isPct = unit === '%';
  const toDisplay = (v) => isPct ? +(v * 100).toFixed(2) : v;
  const fromDisplay = (v) => isPct ? v / 100 : v;
  const [txt, setTxt] = useState(String(toDisplay(value)));
  useEffect(() => { setTxt(String(toDisplay(value))); }, [value]);

  const commit = () => {
    let v = parseFloat(txt.replace(',', '.'));
    if (isNaN(v)) { setTxt(String(toDisplay(value))); return; }
    v = fromDisplay(v);
    v = Math.max(min, Math.min(max, v));
    onChange(v);
  };

  return (
    <div className="param">
      <div className="param-head">
        <label>{label}{info && <Info text={info} />}</label>
        <span className="param-edit">
          <input type="text" inputMode="decimal" value={txt}
            onChange={(e) => setTxt(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          <span className="param-unit">{unit || '€'}</span>
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} className="slider" />
      {hint && <div className="param-hint">{hint}</div>}
    </div>
  );
}

export default function App() {
  const [p, setP] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...DEFAULTS, ...JSON.parse(saved) };
    } catch (e) { /* indispo */ }
    return DEFAULTS;
  });
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
  }, [p]);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSensi, setShowSensi] = useState(false);
  const [showCashflow, setShowCashflow] = useState(false);
  const [horizon, setHorizon] = useState(20);

  const set = (k) => (v) => setP((prev) => ({ ...prev, [k]: v }));
  const reset = () => setP(DEFAULTS);
  const m = useMemo(() => computeModel(p), [p]);

  const r = m.rows[horizon];
  const verdict = r.patrimoineLoc > r.patrimoineAchat ? 'LOUER' : 'ACHETER';
  const ecart = Math.abs(r.patrimoineLoc - r.patrimoineAchat);

  const mensualiteMax = p.revenusFoyer * 0.35;
  const tauxEndettement = p.revenusFoyer > 0 ? (m.mensualiteTotale / p.revenusFoyer) : 0;
  const capaciteEmprunt = (() => {
    const mR = p.taux / 12; const nper = p.dureeCredit * 12;
    const capital = mR > 0 ? mensualiteMax * (1 - Math.pow(1 + mR, -nper)) / mR : mensualiteMax * nper;
    return capital * 0.93;
  })();

  const chartData = m.rows.slice(1).map((row) => ({
    annee: row.annee,
    Acheter: Math.round(row.patrimoineAchat / 1000),
    Louer: Math.round(row.patrimoineLoc / 1000),
  }));

  const disciplines = [0, 0.25, 0.5, 0.75, 1.0];
  const rendements = [0.03, 0.04, 0.05, 0.06, 0.07];
  const t1 = disciplines.map((d) =>
    rendements.map((rd) => {
      const mm = computeModel({ ...p, discipline: d, rendement: rd });
      const rr = mm.rows[horizon];
      return Math.round((rr.patrimoineLoc - rr.patrimoineAchat) / 1000);
    })
  );

  const apprecs = [0, 0.01, 0.02, 0.03, 0.04];
  const durees = [5, 10, 15, 20, 25];
  const t2 = apprecs.map((a) =>
    durees.map((dur) => {
      const mm = computeModel({ ...p, appreciation: a });
      const rr = mm.rows[dur];
      return Math.round((rr.patrimoineLoc - rr.patrimoineAchat) / 1000);
    })
  );

  return (
    <>
      <style>{`
        * { box-sizing:border-box; margin:0; padding:0; }
        body { background:#0E1B2C; }
        .app {
          --ink:#0E1B2C; --ink2:#1B2D44; --paper:#F7F5F0; --line:#D8D3C7;
          --buy:#0E7C5A; --buy-bg:#E3F0EA; --rent:#C9622E; --rent-bg:#F6E7DC;
          --muted:#6B7686; --accent:#E8B23A;
          font-family:'Inter','Helvetica Neue',Arial,sans-serif; color:var(--ink);
          background:var(--paper); min-height:100vh;
        }
        .wrap { max-width:1180px; margin:0 auto; padding:0 16px; }
        .hero { background:var(--ink); color:var(--paper); padding:34px 0 28px; }
        .hero-eyebrow { font-family:'Roboto Mono',ui-monospace,monospace; font-size:11px; letter-spacing:.28em;
          text-transform:uppercase; color:var(--accent); margin-bottom:13px; }
        .hero h1 { font-family:Georgia,'Times New Roman',serif; font-weight:500; font-size:clamp(26px,5vw,46px);
          line-height:1.06; letter-spacing:-.01em; }
        .hero h1 em { font-style:italic; color:var(--accent); }
        .principes { margin-top:18px; max-width:700px; }
        .principes li { font-size:13px; line-height:1.5; color:#C7D0DC; margin-bottom:7px; list-style:none;
          padding-left:20px; position:relative; }
        .principes li::before { content:'→'; position:absolute; left:0; color:var(--accent); }
        .principes b { color:var(--paper); font-weight:600; }
        .grid { display:grid; grid-template-columns:1fr; gap:0; }
        @media(min-width:900px){ .grid { grid-template-columns:390px 1fr; } }
        .panel { background:var(--paper); padding:24px 0; }
        @media(min-width:900px){
          .panel-left { border-right:1px solid var(--line); padding-right:28px; }
          .panel-right { padding-left:28px; }
        }
        .panel-title { font-family:'Roboto Mono',ui-monospace,monospace; font-size:11px; letter-spacing:.2em;
          text-transform:uppercase; color:var(--muted); margin-bottom:16px; display:flex; align-items:center;
          gap:8px; justify-content:space-between; }
        .panel-title .lbl { display:flex; align-items:center; gap:8px; }
        .panel-title .lbl::before { content:''; width:18px; height:2px; background:var(--accent); }
        .reset-btn { font-family:'Roboto Mono',monospace; font-size:10px; letter-spacing:.1em; text-transform:uppercase;
          background:none; border:1px solid var(--line); color:var(--muted); padding:4px 10px; border-radius:6px; cursor:pointer; }
        .reset-btn:hover { border-color:var(--ink); color:var(--ink); }
        .section { border-radius:11px; padding:16px 16px 4px; margin-bottom:18px; border:1px solid var(--line); }
        .section.buy { background:var(--buy-bg); border-color:#BFD9CD; }
        .section.rent { background:var(--rent-bg); border-color:#E6CDB8; }
        .section.neutral { background:#EEEAE1; border-color:var(--line); }
        .section-head { display:flex; align-items:center; gap:9px; margin-bottom:14px; }
        .section-tag { font-family:'Roboto Mono',monospace; font-size:10px; font-weight:600; letter-spacing:.12em;
          text-transform:uppercase; padding:3px 9px; border-radius:5px; color:#fff; }
        .section-tag.buy { background:var(--buy); } .section-tag.rent { background:var(--rent); }
        .section-tag.neutral { background:var(--muted); }
        .section-name { font-size:13px; font-weight:600; color:var(--ink); }
        .param { margin-bottom:16px; }
        .param-head { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:7px; gap:8px; }
        .param-head label { font-size:13px; font-weight:500; color:var(--ink); display:flex; align-items:center; gap:6px; }
        .param-edit { display:flex; align-items:center; gap:4px; background:rgba(255,255,255,.7); border-radius:5px;
          padding:1px 7px 1px 4px; }
        .param-edit input { width:74px; border:none; background:transparent; text-align:right;
          font-family:'Roboto Mono',monospace; font-size:13.5px; font-weight:500; color:var(--ink); outline:none; padding:2px 2px; }
        .param-edit input:focus { background:rgba(232,178,58,.18); border-radius:3px; }
        .param-unit { font-family:'Roboto Mono',monospace; font-size:12px; color:var(--muted); }
        .param-hint { font-size:11px; color:var(--muted); margin-top:5px; font-style:italic; line-height:1.4; }
        .param-hint a { color:var(--rent); }
        .slider { -webkit-appearance:none; appearance:none; width:100%; height:4px; border-radius:4px;
          background:rgba(0,0,0,.12); outline:none; cursor:pointer; }
        .slider::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:18px; height:18px; border-radius:50%;
          background:var(--ink); border:3px solid var(--paper); box-shadow:0 0 0 1px var(--ink); cursor:pointer; transition:transform .1s; }
        .slider::-webkit-slider-thumb:hover { transform:scale(1.15); }
        .slider::-moz-range-thumb { width:18px; height:18px; border-radius:50%; background:var(--ink);
          border:3px solid var(--paper); box-shadow:0 0 0 1px var(--ink); cursor:pointer; }
        .info-wrap { position:relative; display:inline-flex; cursor:help; }
        .info-dot { width:14px; height:14px; border-radius:50%; background:var(--muted); color:var(--paper); font-size:9px;
          font-weight:700; display:flex; align-items:center; justify-content:center; font-style:italic; font-family:Georgia,serif; }
        .info-wrap:hover .info-dot { background:var(--ink); }
        .info-bubble { position:absolute; bottom:130%; left:50%; transform:translateX(-50%); z-index:30; width:220px;
          background:var(--ink); color:var(--paper); font-size:11.5px; line-height:1.45; font-weight:400; font-style:normal;
          padding:9px 11px; border-radius:8px; box-shadow:0 6px 20px rgba(0,0,0,.25); }
        .info-bubble::after { content:''; position:absolute; top:100%; left:50%; transform:translateX(-50%);
          border:5px solid transparent; border-top-color:var(--ink); }
        .plan { background:rgba(255,255,255,.55); border-radius:8px; padding:11px 13px; margin:2px 0 6px; }
        .plan-row { display:flex; justify-content:space-between; font-size:12px; padding:3px 0; color:var(--ink); }
        .plan-row.tot { border-top:1px solid var(--line); margin-top:4px; padding-top:6px; font-weight:600; }
        .plan-row .v { font-family:'Roboto Mono',monospace; }
        .disclosure { width:100%; text-align:left; background:none; border:none; cursor:pointer; font-family:'Roboto Mono',monospace;
          font-size:11px; letter-spacing:.13em; text-transform:uppercase; color:var(--muted); padding:13px 0;
          border-top:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; }
        .disclosure:hover { color:var(--ink); }
        .disclosure .chev { transition:transform .2s; } .disclosure.open .chev { transform:rotate(180deg); }
        .verdict { padding:20px 22px; border-radius:12px; margin-bottom:20px; color:var(--paper); }
        .verdict.buy { background:var(--buy); } .verdict.rent { background:var(--rent); }
        .verdict-label { font-family:'Roboto Mono',monospace; font-size:11px; letter-spacing:.2em; text-transform:uppercase;
          opacity:.85; margin-bottom:7px; }
        .verdict-main { font-family:Georgia,serif; font-size:36px; font-weight:600; line-height:1; }
        .verdict-sub { margin-top:9px; font-size:13px; opacity:.95; line-height:1.5; } .verdict-sub b { font-weight:700; }
        .horizons { display:flex; gap:6px; margin-bottom:18px; }
        .htab { flex:1; padding:9px 4px; border:1px solid var(--line); background:var(--paper); border-radius:8px; cursor:pointer;
          font-family:'Roboto Mono',monospace; font-size:12px; font-weight:500; color:var(--muted); transition:all .12s; text-align:center; }
        .htab:hover { border-color:var(--ink); }
        .htab.active { background:var(--ink); color:var(--paper); border-color:var(--ink); }
        .stats { display:grid; grid-template-columns:1fr 1fr; gap:1px; background:var(--line); border:1px solid var(--line);
          border-radius:10px; overflow:hidden; margin-bottom:20px; }
        .stat { background:var(--paper); padding:14px; }
        .stat-k { font-size:11px; color:var(--muted); margin-bottom:5px; display:flex; align-items:center; gap:5px; }
        .stat-v { font-family:'Roboto Mono',monospace; font-size:16px; font-weight:500; color:var(--ink); }
        .stat-v.buy { color:var(--buy); } .stat-v.rent { color:var(--rent); }
        .capacite { border:1px solid var(--line); border-radius:10px; padding:16px; margin-bottom:20px; background:#EEEAE1; }
        .capacite-title { font-family:'Roboto Mono',monospace; font-size:10.5px; letter-spacing:.15em; text-transform:uppercase;
          color:var(--muted); margin-bottom:12px; }
        .capacite-row { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px; font-size:13px; }
        .capacite-row .v { font-family:'Roboto Mono',monospace; font-weight:500; }
        .endett-bar { height:8px; border-radius:4px; background:var(--line); overflow:hidden; margin-top:4px; }
        .endett-fill { height:100%; border-radius:4px; }
        .chart-card { border:1px solid var(--line); border-radius:12px; padding:18px 14px 10px; background:var(--paper); margin-bottom:20px; }
        .chart-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; padding:0 4px; flex-wrap:wrap; gap:8px; }
        .chart-title { font-family:Georgia,serif; font-size:17px; font-weight:500; }
        .legend { display:flex; gap:14px; font-size:11.5px; }
        .legend span { display:flex; align-items:center; gap:6px; color:var(--muted); }
        .dot { width:10px; height:3px; border-radius:2px; }
        .tbl { border:1px solid var(--line); border-radius:12px; overflow:hidden; margin-bottom:12px; overflow-x:auto; }
        .tbl table { width:100%; border-collapse:collapse; font-family:'Roboto Mono',monospace; font-size:11.5px; }
        .tbl th, .tbl td { padding:8px 6px; text-align:center; border-bottom:1px solid var(--line); white-space:nowrap; }
        .tbl th { background:#ECE8DF; font-weight:500; color:var(--ink); font-size:10.5px; }
        .tbl td.rowhead { background:#F0EDE5; font-weight:500; }
        .tbl td.buy { color:var(--buy); font-weight:500; } .tbl td.rent { color:var(--rent); font-weight:500; }
        .tbl td.here { outline:2px solid var(--accent); outline-offset:-2px; font-weight:700; }
        .cap { font-size:11px; color:var(--muted); padding:10px 12px; background:#F0EDE5; font-style:italic; line-height:1.4; }
        .tbl-title { font-family:Georgia,serif; font-size:15px; font-weight:500; margin:14px 0 8px; }
        .cf-legend { font-size:11px; color:var(--muted); line-height:1.5; margin-bottom:8px; }
        .cf-legend b { color:var(--ink); }
        .foot { background:var(--ink); color:#9AA6B6; padding:24px 0; font-size:11.5px; line-height:1.6; }
        .foot strong { color:var(--paper); font-weight:600; display:block; margin-bottom:6px; font-family:'Roboto Mono',monospace;
          font-size:10px; letter-spacing:.2em; text-transform:uppercase; }
        .foot a { color:var(--accent); }
      `}</style>

      <div className="app">
        <header className="hero">
          <div className="wrap">
            <div className="hero-eyebrow">Décision patrimoniale · simulateur</div>
            <h1>Résidence principale : acheter, ou louer et placer <em>?</em></h1>
            <ul className="principes">
              <li>On compare deux stratégies à épargne de départ égale : <b>acheter sa résidence principale</b>, ou <b>rester locataire et placer cette épargne</b>.</li>
              <li>Côté location, <b>l'équivalent de l'apport est investi</b> dès le départ (la somme que l'acheteur immobilise dans le bien), et chaque mois <b>l'écart entre ce que sortirait un propriétaire et le loyer</b> vient nourrir cette épargne placée.</li>
              <li>Côté achat, le patrimoine est <b>la valeur nette du bien</b> : sa valeur de revente moins le capital restant dû sur le crédit.</li>
              <li>Le verdict compare le <b>patrimoine net total</b> des deux scénarios, à l'horizon que vous choisissez.</li>
            </ul>
          </div>
        </header>

        <div className="wrap">
          <div className="grid">
            <div className="panel panel-left">
              <div className="panel-title">
                <span className="lbl">Vos hypothèses</span>
                <button className="reset-btn" onClick={reset}>Réinitialiser</button>
              </div>

              <div className="section buy">
                <div className="section-head">
                  <span className="section-tag buy">Achat</span>
                  <span className="section-name">Le bien & son financement</span>
                </div>
                <Param label="Prix du bien" value={p.prix} onChange={set('prix')}
                  min={50000} max={3000000} step={5000} unit="€"
                  info="Prix d'achat affiché du bien, hors frais de notaire. Il peut inclure une commission d'agence selon l'annonce." />
                <Param label="Frais de notaire" value={p.tauxNotaire} onChange={set('tauxNotaire')}
                  min={0.02} max={0.10} step={0.005} unit="%"
                  hint={`Soit ${fmtEurFull(m.fraisNotaire)}`}
                  info="Environ 7-8 % dans l'ancien, 2-3 % dans le neuf. Inclut droits de mutation et émoluments du notaire." />
                <Param label="Travaux & ameublement" value={p.travaux} onChange={set('travaux')}
                  min={0} max={1000000} step={5000} unit="€"
                  info="Travaux initiaux et ameublement nécessaires pour emménager." />
                <Param label="Apport personnel" value={p.apport} onChange={set('apport')}
                  min={0} max={3000000} step={5000} unit="€"
                  info="Somme que vous injectez à l'achat. Le reste du coût total est financé par le crédit. Côté location, cet apport est intégralement investi." />

                {/* PLAN DE FINANCEMENT : coût total − apport = emprunt */}
                <div className="plan">
                  <div className="plan-row"><span>Prix du bien</span><span className="v">{fmtEurFull(p.prix)}</span></div>
                  <div className="plan-row"><span>+ Frais de notaire</span><span className="v">{fmtEurFull(m.fraisNotaire)}</span></div>
                  <div className="plan-row"><span>+ Travaux & ameublement</span><span className="v">{fmtEurFull(p.travaux)}</span></div>
                  <div className="plan-row tot"><span>= Coût total du projet</span><span className="v">{fmtEurFull(m.coutTotalProjet)}</span></div>
                  <div className="plan-row"><span>− Apport personnel</span><span className="v">{fmtEurFull(p.apport)}</span></div>
                  <div className="plan-row tot"><span>= Montant emprunté</span><span className="v">{fmtEurFull(m.montantEmprunte)}</span></div>
                </div>

                <Param label="Durée du crédit" value={p.dureeCredit} onChange={set('dureeCredit')}
                  min={5} max={30} step={1} unit="ans" />
                <Param label="Taux du crédit (hors assurance)" value={p.taux} onChange={set('taux')}
                  min={0.005} max={0.07} step={0.0005} unit="%"
                  hint={<>Taux indicatif marché juin 2026. <a href="https://www.meilleurtaux.com/credit-immobilier/barometre-des-taux.html" target="_blank" rel="noreferrer">Vérifier le baromètre →</a></>}
                  info="Taux nominal annuel du prêt, hors assurance emprunteur (ligne suivante)." />
                <Param label="Taux d'assurance emprunteur" value={p.tauxAssurance} onChange={set('tauxAssurance')}
                  min={0} max={0.01} step={0.0001} unit="%"
                  info="Assurance décès-invalidité, calculée sur le capital emprunté. En général 0,10 % à 0,40 %/an selon l'âge et le profil." />
              </div>

              <div className="section rent">
                <div className="section-head">
                  <span className="section-tag rent">Location</span>
                  <span className="section-name">Le loyer</span>
                </div>
                <Param label="Loyer actuel (mensuel)" value={p.loyer} onChange={set('loyer')}
                  min={300} max={15000} step={50} unit="€"
                  info="Loyer hors charges que vous payez (ou paieriez) en restant locataire d'un bien équivalent." />
                <Param label="Indexation du loyer (IRL) / an" value={p.irl} onChange={set('irl')}
                  min={0} max={0.05} step={0.0025} unit="%"
                  info="Hausse annuelle moyenne du loyer. Sur longue période, l'IRL suit l'inflation, autour de 1,5-2 %/an." />
              </div>

              <div className="section neutral">
                <div className="section-head">
                  <span className="section-tag neutral">Commun</span>
                  <span className="section-name">Épargne, placements & revenus</span>
                </div>
                <Param label="Rendement net de l'épargne / an" value={p.rendement} onChange={set('rendement')}
                  min={0} max={0.12} step={0.0025} unit="%"
                  hint="Rendement net de fiscalité (après flat tax, ou via PEA/AV)"
                  info="Performance annuelle nette d'impôts de votre épargne investie. Un ETF Monde via PEA rapporte historiquement 6-7 %/an nets sur le long terme, avec de la volatilité." />
                <Param label="Discipline d'investissement" value={p.discipline} onChange={set('discipline')}
                  min={0} max={1} step={0.05} unit="%"
                  info="Part de l'écart de trésorerie mensuel (décaissement propriétaire − loyer) que vous investissez réellement, au lieu de la dépenser. C'est le paramètre le plus déterminant du modèle." />
                <Param label="Revenus nets du foyer (mensuel)" value={p.revenusFoyer} onChange={set('revenusFoyer')}
                  min={1000} max={50000} step={100} unit="€"
                  info="Revenus nets mensuels du foyer, pour estimer le taux d'endettement et la capacité d'emprunt." />
              </div>

              <button className={`disclosure ${showAdvanced ? 'open' : ''}`} onClick={() => setShowAdvanced(!showAdvanced)}>
                <span>Hypothèses de marché (avancé)</span><span className="chev">▾</span>
              </button>
              {showAdvanced && (
                <div style={{ paddingTop: 6 }}>
                  <Param label="Appréciation du bien / an" value={p.appreciation} onChange={set('appreciation')}
                    min={-0.02} max={0.06} step={0.0025} unit="%"
                    info="Hausse annuelle moyenne du prix de l'immobilier. Moyenne France longue période ≈ 1,5-2,5 %/an, très variable selon les villes." />
                  <Param label="Décote à la revente" value={p.decoteRevente} onChange={set('decoteRevente')}
                    min={0} max={0.15} step={0.005} unit="%"
                    info="Écart entre la valeur du bien et ce que vous touchez réellement à la revente : frais d'agence, négociation, diagnostics. En vente directe sans agence, proche de 0 %." />
                  <Param label="Taxe foncière (an 1)" value={p.taxeFonciere} onChange={set('taxeFonciere')}
                    min={0} max={15000} step={100} unit="€"
                    info="Surcoût propre au propriétaire : le locataire ne la paie pas." />
                  <Param label="Inflation taxe foncière / an" value={p.inflationTaxe} onChange={set('inflationTaxe')}
                    min={0} max={0.06} step={0.0025} unit="%" />
                  <Param label="Entretien (% valeur du bien / an)" value={p.tauxEntretien} onChange={set('tauxEntretien')}
                    min={0} max={0.04} step={0.0025} unit="%"
                    info="Gros entretien à la charge du propriétaire (toiture, chaudière, ravalement…). Règle courante : ~1 %/an de la valeur du bien." />
                  <Param label="Autres charges propriétaire / an" value={p.chargesProp} onChange={set('chargesProp')}
                    min={0} max={15000} step={100} unit="€"
                    info="Surcoûts que seul le propriétaire supporte : charges de copropriété non récupérables, assurance PNO… Hors taxe foncière (ligne dédiée)." />
                  <Param label="Inflation des charges / an" value={p.inflationCharges} onChange={set('inflationCharges')}
                    min={0} max={0.06} step={0.0025} unit="%" />
                </div>
              )}
            </div>

            <div className="panel panel-right">
              <div className="panel-title"><span className="lbl">Le verdict</span></div>

              <div className="horizons">
                {[5, 10, 15, 20, 25].map((h) => (
                  <button key={h} className={`htab ${horizon === h ? 'active' : ''}`} onClick={() => setHorizon(h)}>{h} ans</button>
                ))}
              </div>

              <div className={`verdict ${verdict === 'ACHETER' ? 'buy' : 'rent'}`}>
                <div className="verdict-label">À {horizon} ans, mieux vaut</div>
                <div className="verdict-main">{verdict}</div>
                <div className="verdict-sub">Écart de patrimoine net : <b>{fmtEur(ecart)}</b> en faveur de cette stratégie.</div>
              </div>

              <div className="stats">
                <div className="stat"><div className="stat-k">Patrimoine si ACHAT</div><div className="stat-v buy">{fmtEur(r.patrimoineAchat)}</div></div>
                <div className="stat"><div className="stat-k">Patrimoine si LOCATION</div><div className="stat-v rent">{fmtEur(r.patrimoineLoc)}</div></div>
                <div className="stat"><div className="stat-k">Montant emprunté</div><div className="stat-v">{fmtEur(m.montantEmprunte)}</div></div>
                <div className="stat"><div className="stat-k">Mensualité (assur. incl.)</div><div className="stat-v">{fmtEurFull(m.mensualiteTotale)}</div></div>
                <div className="stat"><div className="stat-k">Ratio prix / loyer annuel <Info text="Prix du bien ÷ loyer annuel. En dessous de 15, l'achat est souvent gagnant ; au-dessus de 25, la location tend à l'emporter." /></div><div className="stat-v">{m.ratioPrixLoyer.toFixed(1)}</div></div>
                <div className="stat"><div className="stat-k">Écart de trésorerie / mois <Info text="Différence entre le décaissement mensuel d'un propriétaire et le loyer. C'est ce que le locataire peut investir chaque mois selon sa discipline." /></div><div className="stat-v">{fmtEurFull((m.rows[1].decaissementAchat - m.rows[1].loyerAnnuel) / 12)}</div></div>
              </div>

              <div className="capacite">
                <div className="capacite-title">Capacité d'emprunt & endettement</div>
                <div className="capacite-row">
                  <span>Taux d'endettement de ce projet</span>
                  <span className="v" style={{ color: tauxEndettement > 0.35 ? 'var(--rent)' : 'var(--buy)' }}>{(tauxEndettement * 100).toFixed(1)} %</span>
                </div>
                <div className="endett-bar">
                  <div className="endett-fill" style={{ width: `${Math.min(100, tauxEndettement / 0.35 * 100)}%`, background: tauxEndettement > 0.35 ? 'var(--rent)' : 'var(--buy)' }}></div>
                </div>
                <div className="capacite-row" style={{ marginTop: 12 }}><span>Mensualité max conseillée (35 %)</span><span className="v">{fmtEurFull(mensualiteMax)}</span></div>
                <div className="capacite-row"><span>Capacité d'emprunt indicative</span><span className="v">{fmtEur(capaciteEmprunt)}</span></div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', marginTop: 8, lineHeight: 1.4 }}>
                  Sur la base de 35 % d'endettement maximum, à la durée et au taux choisis. Les banques étudient aussi le reste à vivre et l'apport.
                </div>
              </div>

              <div className="chart-card">
                <div className="chart-head">
                  <div className="chart-title">Patrimoine net, an par an</div>
                  <div className="legend">
                    <span><i className="dot" style={{ background: 'var(--buy)' }}></i>Acheter</span>
                    <span><i className="dot" style={{ background: 'var(--rent)' }}></i>Louer + placer</span>
                  </div>
                </div>
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <LineChart data={chartData} margin={{ top: 6, right: 14, left: 6, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="#E2DDD2" vertical={false} />
                      <XAxis dataKey="annee" tick={{ fontSize: 11, fill: '#6B7686', fontFamily: 'Roboto Mono' }} axisLine={{ stroke: '#D8D3C7' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#6B7686', fontFamily: 'Roboto Mono' }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}M` : `${v}k`} width={42} />
                      <Tooltip contentStyle={{ background: '#0E1B2C', border: 'none', borderRadius: 8, fontSize: 12, fontFamily: 'Inter', color: '#F7F5F0' }} labelStyle={{ color: '#E8B23A', fontFamily: 'Roboto Mono', fontSize: 11 }} formatter={(v, name) => [`${v.toLocaleString('fr-FR')} k€`, name]} labelFormatter={(l) => `Année ${l}`} />
                      <ReferenceLine x={horizon} stroke="#E8B23A" strokeDasharray="3 3" strokeWidth={1.5} />
                      <Line type="monotone" dataKey="Acheter" stroke="#0E7C5A" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="Louer" stroke="#C9622E" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <button className={`disclosure ${showSensi ? 'open' : ''}`} onClick={() => setShowSensi(!showSensi)}>
                <span>Tables de sensibilité</span><span className="chev">▾</span>
              </button>
              {showSensi && (
                <div>
                  <div className="tbl-title">1 · Qui gagne selon votre discipline et le rendement (à {horizon} ans)</div>
                  <div className="tbl">
                    <table>
                      <thead><tr><th>Disc.↓ / Rdt→</th>{rendements.map((rd) => <th key={rd}>{(rd * 100).toFixed(0)}%</th>)}</tr></thead>
                      <tbody>
                        {disciplines.map((d, i) => (
                          <tr key={d}>
                            <td className="rowhead">{(d * 100).toFixed(0)}%</td>
                            {t1[i].map((v, j) => {
                              const isHere = Math.abs(d - p.discipline) < 0.001 && Math.abs(rendements[j] - p.rendement) < 0.001;
                              return <td key={j} className={`${v > 0 ? 'rent' : 'buy'} ${isHere ? 'here' : ''}`}>{v > 0 ? `+${v}` : v}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="cap">Écart de patrimoine location − achat (k€). <b style={{ color: 'var(--rent)' }}>Orange positif</b> = louer gagne ; <b style={{ color: 'var(--buy)' }}>vert négatif</b> = acheter gagne. Cadre jaune = vos réglages actuels.</div>
                  </div>

                  <div className="tbl-title">2 · Qui gagne selon le marché immobilier et la durée de détention</div>
                  <div className="tbl">
                    <table>
                      <thead><tr><th>Apprec.↓ / Détention→</th>{durees.map((dur) => <th key={dur}>{dur} ans</th>)}</tr></thead>
                      <tbody>
                        {apprecs.map((a, i) => (
                          <tr key={a}>
                            <td className="rowhead">{(a * 100).toFixed(0)}%/an</td>
                            {t2[i].map((v, j) => {
                              const isHere = Math.abs(a - p.appreciation) < 0.001 && durees[j] === horizon;
                              return <td key={j} className={`${v > 0 ? 'rent' : 'buy'} ${isHere ? 'here' : ''}`}>{v > 0 ? `+${v}` : v}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="cap">Écart location − achat (k€) selon l'appréciation annuelle du bien et la <b>durée de détention avant revente</b> (l'horizon auquel on compare les deux patrimoines). Montre à partir de combien d'années l'achat devient gagnant. À chaque durée, on simule la revente du bien au prix réévalué, net du capital restant dû.</div>
                  </div>
                </div>
              )}

              <button className={`disclosure ${showCashflow ? 'open' : ''}`} onClick={() => setShowCashflow(!showCashflow)}>
                <span>Trésorerie détaillée, an par an</span><span className="chev">▾</span>
              </button>
              {showCashflow && (
                <div>
                  <div className="cf-legend" style={{ marginTop: 10 }}>
                    Ce tableau montre <b>l'argent qui sort réellement du compte</b> chaque année. Côté achat, le décaissement se décompose en <b>argent perdu</b> (intérêts, assurance, taxe, entretien, charges) et <b>épargne forcée</b> (capital remboursé, qui construit votre patrimoine). L'<b>écart de trésorerie</b> avec le loyer est ce que le locataire peut investir.
                  </div>
                  <div className="tbl">
                    <table>
                      <thead>
                        <tr>
                          <th>An</th><th>Intérêts</th><th>Assur.</th><th>Taxe F.</th><th>Entret.</th><th>Charges</th>
                          <th>Capital</th><th>Décaiss. proprio</th><th>Loyer</th><th>Écart trés.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.rows.filter((row) => row.annee > 0 && row.annee <= horizon).map((row) => (
                          <tr key={row.annee}>
                            <td className="rowhead">{row.annee}</td>
                            <td>{fmtEur(row.interets)}</td>
                            <td>{fmtEur(row.annuiteAssur)}</td>
                            <td>{fmtEur(row.taxe)}</td>
                            <td>{fmtEur(row.entretien)}</td>
                            <td>{fmtEur(row.chargesProp)}</td>
                            <td className="buy">{fmtEur(row.capitalRembourse)}</td>
                            <td className="buy">{fmtEur(row.decaissementAchat)}</td>
                            <td className="rent">{fmtEur(row.loyerAnnuel)}</td>
                            <td>{fmtEur(row.ecartDecaissement)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="cap">Décaissement proprio = intérêts + assurance + taxe + entretien + charges + capital. Écart trés. = décaissement proprio − loyer (ce que le locataire ne dépense pas et peut investir). Montants annuels.</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <footer className="foot">
          <div className="wrap">
            <strong>Outil pédagogique</strong>
            Ce simulateur est fourni à titre informatif et pédagogique uniquement. Il ne constitue ni un conseil en investissement, ni une recommandation patrimoniale, immobilière ou fiscale. Les hypothèses de rendement sont déterministes et ne reflètent pas la volatilité réelle des marchés ; les performances passées ne préjugent pas des performances futures. Pour une décision personnalisée, consultez un professionnel agréé (notaire, conseiller en gestion de patrimoine, courtier). Vos réglages sont enregistrés uniquement sur votre appareil.
          </div>
        </footer>
      </div>
    </>
  );
}
