import { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine, CartesianGrid } from 'recharts';

// ============================================================
// FINANCIAL CALCULATIONS
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
  const monthlyRate = p.taux / 12;
  const totalMonths = p.dureeCredit * 12;
  const fraisNotaire = p.prix * p.tauxNotaire;
  const apportEffectif = p.apport - fraisNotaire;
  const montantEmprunte = p.prix + p.travaux - apportEffectif;
  const mensualiteCredit = -pmt(monthlyRate, totalMonths, montantEmprunte);
  const assuranceMensuelle = (montantEmprunte * p.tauxAssurance) / 12;
  const cashResiduel = p.cashTotal - p.apport;

  let portfolioInitial = cashResiduel;
  let portfolioDifferentiel = 0;
  let portfolioInitialLoc = p.cashTotal;
  let portfolioDifferentielLoc = 0;

  for (let n = 0; n <= 25; n++) {
    const valeurBien = p.prix * Math.pow(1 + p.appreciation, n);
    let crd = 0;
    if (n <= p.dureeCredit) {
      crd = -fv(monthlyRate, n * 12, -mensualiteCredit, montantEmprunte);
    }

    const annuiteCreditNu = n === 0 ? 0 : (n <= p.dureeCredit ? mensualiteCredit * 12 : 0);
    const annuiteAssurance = n === 0 ? 0 : (n <= p.dureeCredit ? assuranceMensuelle * 12 : 0);
    const taxeFonciere = n === 0 ? 0 : p.taxeFonciereInit * Math.pow(1 + p.inflationTaxe, n - 1);
    const entretien = n === 0 ? 0 : valeurBien * p.tauxEntretien;
    const charges = n === 0 ? 0 : (p.chargesPiscine + p.assuranceHabProp) * Math.pow(1 + p.inflationCharges, n - 1);
    const coutAnnuelProp = annuiteCreditNu + annuiteAssurance + taxeFonciere + entretien + charges;

    const equiteBien = valeurBien * (1 - p.fraisAgence) - crd;
    const patrimoineAchat = equiteBien + portfolioInitial;

    const loyerAnnuel = n === 0 ? 0 : p.loyer * 12 * Math.pow(1 + p.irl, n - 1);
    const assuranceLoc = n === 0 ? 0 : p.assuranceHabLoc * Math.pow(1 + p.inflationCharges, n - 1);
    const coutLocataireTotal = loyerAnnuel + assuranceLoc;
    const economieLocataire = coutAnnuelProp - coutLocataireTotal;
    const investissementAnnuel = Math.max(0, economieLocataire) * p.discipline;

    const patrimoineLocation = portfolioInitialLoc + portfolioDifferentielLoc;

    rows.push({
      annee: n,
      valeurBien,
      crd,
      coutAnnuelProp,
      equiteBien,
      patrimoineAchat,
      portfolioInitialAchat: portfolioInitial,
      coutLocataireTotal,
      economieLocataire,
      investissementAnnuel,
      portfolioInitialLoc,
      portfolioDifferentielLoc,
      patrimoineLocation,
    });

    // Update portfolios for next year
    portfolioInitial *= (1 + p.rendement);
    portfolioInitialLoc *= (1 + p.rendement);
    portfolioDifferentielLoc = portfolioDifferentielLoc * (1 + p.rendement) + investissementAnnuel;
  }

  return {
    rows,
    fraisNotaire,
    apportEffectif,
    montantEmprunte,
    mensualiteCredit,
    assuranceMensuelle,
    mensualiteTotale: mensualiteCredit + assuranceMensuelle,
    cashResiduel,
    ratioPrixLoyer: p.prix / (p.loyer * 12),
  };
}

// ============================================================
// FORMATTERS
// ============================================================
const fmtEur = (n) => {
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)} M€`;
  if (Math.abs(n) >= 1e3) return `${Math.round(n / 1e3).toLocaleString('fr-FR')} k€`;
  return `${Math.round(n).toLocaleString('fr-FR')} €`;
};
const fmtEurFull = (n) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const fmtPct = (n) => `${(n * 100).toFixed(2)} %`;

// ============================================================
// REUSABLE INPUT COMPONENT
// ============================================================
function InputRow({ label, value, onChange, suffix, step = 1, hint, isPct }) {
  const displayValue = isPct ? (value * 100).toFixed(2) : value;
  return (
    <div className="flex items-center justify-between gap-2 py-2 border-b border-stone-200/70 last:border-b-0">
      <div className="flex-1">
        <div className="text-[12.5px] text-stone-700 leading-tight">{label}</div>
        {hint && <div className="text-[10.5px] text-stone-400 italic mt-0.5">{hint}</div>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <input
          type="number"
          step={step}
          value={displayValue}
          onChange={(e) => {
            const raw = parseFloat(e.target.value);
            if (isNaN(raw)) return;
            onChange(isPct ? raw / 100 : raw);
          }}
          className="w-24 px-2 py-1 text-right text-[13px] tabular-nums bg-amber-50 border border-amber-200/80 rounded focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-500 transition-all"
          style={{ fontFamily: '"JetBrains Mono", monospace' }}
        />
        <span className="text-[11px] text-stone-500 w-5">{suffix}</span>
      </div>
    </div>
  );
}

function CalcRow({ label, value, fmt = fmtEur, accent }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2 border-b border-stone-200/70 last:border-b-0">
      <div className="text-[12.5px] text-stone-600">{label}</div>
      <div
        className={`text-[13px] tabular-nums font-medium ${accent ? 'text-orange-700' : 'text-stone-900'}`}
        style={{ fontFamily: '"JetBrains Mono", monospace' }}
      >
        {fmt(value)}
      </div>
    </div>
  );
}

function SectionTitle({ children, num }) {
  return (
    <div className="flex items-baseline gap-3 mb-3">
      <span
        className="text-[10px] tracking-[0.2em] text-orange-700 font-semibold"
        style={{ fontFamily: '"JetBrains Mono", monospace' }}
      >
        §{num}
      </span>
      <h3
        className="text-[13.5px] tracking-[0.12em] uppercase text-stone-900 font-semibold"
        style={{ fontFamily: '"DM Sans", sans-serif' }}
      >
        {children}
      </h3>
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function App() {
  const [params, setParams] = useState({
    prix: 800000,
    tauxNotaire: 0.08,
    travaux: 100000,
    appreciation: 0.015,
    fraisAgence: 0.05,
    cashTotal: 600000,
    apport: 300000,
    dureeCredit: 25,
    taux: 0.033,
    tauxAssurance: 0.003,
    taxeFonciereInit: 3000,
    inflationTaxe: 0.03,
    tauxEntretien: 0.01,
    chargesPiscine: 2000,
    assuranceHabProp: 800,
    inflationCharges: 0.02,
    loyer: 2200,
    irl: 0.015,
    assuranceHabLoc: 200,
    rendement: 0.05,
    discipline: 0.7,
  });

  const update = (key) => (value) => setParams((p) => ({ ...p, [key]: value }));

  const model = useMemo(() => computeModel(params), [params]);

  const horizons = [5, 10, 15, 20, 25];
  const synthese = horizons.map((h) => {
    const r = model.rows[h];
    return {
      horizon: h,
      achat: r.patrimoineAchat,
      location: r.patrimoineLocation,
      ecart: r.patrimoineLocation - r.patrimoineAchat,
      verdict: r.patrimoineLocation > r.patrimoineAchat ? 'LOCATION' : 'ACHAT',
    };
  });

  const verdictGlobal20 = synthese[3].verdict;
  const ecart20 = Math.abs(synthese[3].ecart);

  const chartData = model.rows.slice(1).map((r) => ({
    annee: r.annee,
    'Patrimoine ACHAT': Math.round(r.patrimoineAchat / 1000),
    'Patrimoine LOCATION': Math.round(r.patrimoineLocation / 1000),
  }));

  // Sensitivity table: discipline × rendement, patrimoine LOCATION at 20 years
  const disciplines = [0, 0.3, 0.5, 0.7, 1.0];
  const rendements = [0.02, 0.03, 0.04, 0.05, 0.06, 0.07];

  const sensiTable = disciplines.map((d) =>
    rendements.map((r) => {
      const m = computeModel({ ...params, discipline: d, rendement: r });
      return Math.round(m.rows[20].patrimoineLocation / 1000);
    })
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        body { margin: 0; }
        .display-font { font-family: "Fraunces", serif; font-feature-settings: "ss01" on, "ss02" on; }
        .body-font { font-family: "DM Sans", sans-serif; }
        .mono-font { font-family: "JetBrains Mono", monospace; }
        .grain {
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.08 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        }
      `}</style>

      <div className="min-h-screen bg-[#FAF7F2] text-stone-900 body-font relative">
        {/* Grain texture overlay */}
        <div className="grain fixed inset-0 pointer-events-none opacity-50 z-50 mix-blend-multiply"></div>

        {/* HEADER */}
        <header className="border-b border-stone-300/60 bg-[#FAF7F2]">
          <div className="max-w-[1380px] mx-auto px-6 lg:px-10 py-8 lg:py-12">
            <div className="flex items-start justify-between gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-1.5 h-1.5 bg-orange-700 rounded-full animate-pulse"></div>
                  <span className="text-[10px] tracking-[0.3em] text-stone-600 mono-font uppercase">
                    Simulateur patrimonial · v1.0
                  </span>
                </div>
                <h1 className="display-font text-[40px] lg:text-[58px] leading-[0.95] tracking-tight font-medium text-stone-900">
                  Acheter ou louer
                  <span className="italic text-orange-700">,</span>
                  <br />
                  <span className="italic text-stone-500">vraiment ?</span>
                </h1>
                <p className="mt-4 text-[14px] text-stone-600 max-w-2xl leading-relaxed">
                  Un modèle financier rigoureux pour comparer l'achat de votre résidence principale à la location avec investissement de l'épargne.
                  Chaque paramètre est ajustable — la conclusion change avec vos hypothèses.
                </p>
              </div>
              <div className="hidden lg:block text-right shrink-0">
                <div className="text-[10px] tracking-[0.2em] text-stone-500 mono-font uppercase mb-1">Verdict 20 ans</div>
                <div
                  className={`display-font text-[34px] font-medium leading-none ${
                    verdictGlobal20 === 'LOCATION' ? 'text-orange-700' : 'text-emerald-700'
                  }`}
                >
                  {verdictGlobal20}
                </div>
                <div className="text-[11px] text-stone-500 mono-font mt-1">
                  +{fmtEur(ecart20)}
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-[1380px] mx-auto px-6 lg:px-10 py-10 lg:py-14">
          {/* SYNTHÈSE — TOP */}
          <section className="mb-14">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-stone-300/60 rounded-lg overflow-hidden border border-stone-300/60">
              {synthese.map((s) => (
                <div key={s.horizon} className="bg-[#FAF7F2] p-5 lg:p-6 hover:bg-amber-50/50 transition-colors">
                  <div className="text-[10px] tracking-[0.2em] text-stone-500 mono-font uppercase mb-3">
                    Horizon · {s.horizon} ans
                  </div>
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between items-baseline">
                      <span className="text-[11px] text-stone-500">Achat</span>
                      <span className="mono-font text-[13px] tabular-nums text-stone-700">{fmtEur(s.achat)}</span>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-[11px] text-stone-500">Location</span>
                      <span className="mono-font text-[13px] tabular-nums text-stone-700">{fmtEur(s.location)}</span>
                    </div>
                  </div>
                  <div className={`pt-3 border-t border-stone-300/50 ${s.verdict === 'LOCATION' ? 'text-orange-700' : 'text-emerald-700'}`}>
                    <div className="display-font text-[22px] font-medium leading-none">{s.verdict}</div>
                    <div className="text-[11px] mono-font tabular-nums mt-1 opacity-70">
                      écart {fmtEur(Math.abs(s.ecart))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* PARAMETERS GRID */}
          <section className="mb-14">
            <div className="mb-6">
              <h2 className="display-font italic text-[26px] text-stone-700 mb-1">Paramètres</h2>
              <p className="text-[12px] text-stone-500">Modifiez les valeurs — tout se recalcule en temps réel.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* COL 1 : BIEN + FINANCEMENT */}
              <div className="space-y-6">
                <div className="bg-white/60 border border-stone-200/80 rounded-lg p-5 backdrop-blur-sm">
                  <SectionTitle num="01">Bien immobilier</SectionTitle>
                  <InputRow label="Prix du bien" value={params.prix} onChange={update('prix')} suffix="€" step={5000} />
                  <InputRow label="Frais de notaire" value={params.tauxNotaire} onChange={update('tauxNotaire')} suffix="%" isPct step={0.5} hint="Bouches-du-Rhône post-DMTO ~8%" />
                  <InputRow label="Travaux & ameublement" value={params.travaux} onChange={update('travaux')} suffix="€" step={5000} />
                  <InputRow label="Appréciation annuelle" value={params.appreciation} onChange={update('appreciation')} suffix="%" isPct step={0.25} hint="Aix médiane ~1.5%/an" />
                  <InputRow label="Frais d'agence à la revente" value={params.fraisAgence} onChange={update('fraisAgence')} suffix="%" isPct step={0.5} />
                </div>

                <div className="bg-white/60 border border-stone-200/80 rounded-lg p-5 backdrop-blur-sm">
                  <SectionTitle num="02">Financement</SectionTitle>
                  <InputRow label="Cash total disponible" value={params.cashTotal} onChange={update('cashTotal')} suffix="€" step={10000} />
                  <InputRow label="Apport injecté" value={params.apport} onChange={update('apport')} suffix="€" step={10000} />
                  <InputRow label="Durée du crédit" value={params.dureeCredit} onChange={update('dureeCredit')} suffix="ans" step={1} />
                  <InputRow label="Taux nominal annuel" value={params.taux} onChange={update('taux')} suffix="%" isPct step={0.1} hint="Avril 2026 : ~3.30% sur 25 ans" />
                  <InputRow label="Assurance emprunteur" value={params.tauxAssurance} onChange={update('tauxAssurance')} suffix="%" isPct step={0.05} />
                </div>
              </div>

              {/* COL 2 : COÛTS RÉCURRENTS + LOCATION */}
              <div className="space-y-6">
                <div className="bg-white/60 border border-stone-200/80 rounded-lg p-5 backdrop-blur-sm">
                  <SectionTitle num="03">Coûts propriétaire récurrents</SectionTitle>
                  <InputRow label="Taxe foncière (an 1)" value={params.taxeFonciereInit} onChange={update('taxeFonciereInit')} suffix="€" step={100} />
                  <InputRow label="Inflation taxe foncière" value={params.inflationTaxe} onChange={update('inflationTaxe')} suffix="%" isPct step={0.5} />
                  <InputRow label="Entretien (% valeur/an)" value={params.tauxEntretien} onChange={update('tauxEntretien')} suffix="%" isPct step={0.25} hint="1% standard, 1.5-2% pour maison ancienne" />
                  <InputRow label="Charges piscine + autres" value={params.chargesPiscine} onChange={update('chargesPiscine')} suffix="€" step={500} />
                  <InputRow label="Assurance habitation propriétaire" value={params.assuranceHabProp} onChange={update('assuranceHabProp')} suffix="€" step={50} />
                  <InputRow label="Inflation autres charges" value={params.inflationCharges} onChange={update('inflationCharges')} suffix="%" isPct step={0.5} />
                </div>

                <div className="bg-white/60 border border-stone-200/80 rounded-lg p-5 backdrop-blur-sm">
                  <SectionTitle num="04">Location</SectionTitle>
                  <InputRow label="Loyer mensuel actuel" value={params.loyer} onChange={update('loyer')} suffix="€" step={50} />
                  <InputRow label="Indexation IRL" value={params.irl} onChange={update('irl')} suffix="%" isPct step={0.25} hint="IRL réel ~1.5-2%/an" />
                  <InputRow label="Assurance habitation locataire" value={params.assuranceHabLoc} onChange={update('assuranceHabLoc')} suffix="€" step={20} />
                </div>
              </div>

              {/* COL 3 : INVESTMENT + RESULTS */}
              <div className="space-y-6">
                <div className="bg-white/60 border border-stone-200/80 rounded-lg p-5 backdrop-blur-sm">
                  <SectionTitle num="05">Investissement</SectionTitle>
                  <InputRow label="Rendement portefeuille net" value={params.rendement} onChange={update('rendement')} suffix="%" isPct step={0.25} hint="ETF Monde via PEA ~5-7% nets" />
                  <InputRow label="Discipline d'investissement" value={params.discipline} onChange={update('discipline')} suffix="%" isPct step={5} hint="100%=parfaite | 70%=normale | 30%=limitée" />
                </div>

                <div className="bg-stone-900 text-stone-100 rounded-lg p-5">
                  <SectionTitle num="06">
                    <span className="text-stone-100">Résultats clés</span>
                  </SectionTitle>
                  <div className="space-y-2 text-stone-300">
                    <div className="flex justify-between items-baseline py-1.5 border-b border-stone-700/50">
                      <span className="text-[12px]">Frais de notaire</span>
                      <span className="mono-font text-[13px] tabular-nums">{fmtEurFull(model.fraisNotaire)}</span>
                    </div>
                    <div className="flex justify-between items-baseline py-1.5 border-b border-stone-700/50">
                      <span className="text-[12px]">Montant emprunté</span>
                      <span className="mono-font text-[13px] tabular-nums">{fmtEurFull(model.montantEmprunte)}</span>
                    </div>
                    <div className="flex justify-between items-baseline py-1.5 border-b border-stone-700/50">
                      <span className="text-[12px]">Mensualité totale</span>
                      <span className="mono-font text-[13px] tabular-nums text-orange-400 font-medium">{fmtEurFull(model.mensualiteTotale)}</span>
                    </div>
                    <div className="flex justify-between items-baseline py-1.5 border-b border-stone-700/50">
                      <span className="text-[12px]">Cash résiduel à investir</span>
                      <span className="mono-font text-[13px] tabular-nums">{fmtEurFull(model.cashResiduel)}</span>
                    </div>
                    <div className="flex justify-between items-baseline py-1.5">
                      <span className="text-[12px]">Ratio prix / loyer annuel</span>
                      <span className={`mono-font text-[13px] tabular-nums font-medium ${
                        model.ratioPrixLoyer < 18 ? 'text-emerald-400' :
                        model.ratioPrixLoyer < 25 ? 'text-amber-400' : 'text-orange-400'
                      }`}>
                        {model.ratioPrixLoyer.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  <p className="text-[10px] text-stone-500 italic mt-3 leading-relaxed">
                    Ratio &lt;15 : achat OK · 18-25 : zone grise · &gt;25 : louer plus rationnel
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* CHART */}
          <section className="mb-14">
            <div className="mb-6 flex items-baseline justify-between flex-wrap gap-3">
              <div>
                <h2 className="display-font italic text-[26px] text-stone-700 mb-1">Évolution du patrimoine</h2>
                <p className="text-[12px] text-stone-500">Projection sur 25 ans selon les hypothèses ci-dessus.</p>
              </div>
              <div className="flex gap-4 text-[11px] mono-font">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-0.5 bg-emerald-700"></div>
                  <span className="text-stone-600">ACHAT</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-0.5 bg-orange-700"></div>
                  <span className="text-stone-600">LOCATION</span>
                </div>
              </div>
            </div>

            <div className="bg-white/60 border border-stone-200/80 rounded-lg p-5 lg:p-7">
              <div style={{ width: '100%', height: 380 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 10, right: 30, left: 30, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="#D6D3D1" vertical={false} />
                    <XAxis
                      dataKey="annee"
                      tick={{ fontSize: 11, fill: '#78716C', fontFamily: 'JetBrains Mono' }}
                      axisLine={{ stroke: '#A8A29E' }}
                      tickLine={{ stroke: '#A8A29E' }}
                      label={{ value: 'Année', position: 'insideBottom', offset: -5, style: { fontSize: 11, fill: '#78716C' } }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#78716C', fontFamily: 'JetBrains Mono' }}
                      axisLine={{ stroke: '#A8A29E' }}
                      tickLine={{ stroke: '#A8A29E' }}
                      tickFormatter={(v) => `${v >= 1000 ? (v / 1000).toFixed(1) + ' M' : v + ' k'}`}
                      label={{ value: 'Patrimoine (k€)', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#78716C' } }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#FAF7F2',
                        border: '1px solid #D6D3D1',
                        borderRadius: 6,
                        fontSize: 12,
                        fontFamily: 'DM Sans',
                      }}
                      formatter={(v) => `${v.toLocaleString('fr-FR')} k€`}
                      labelFormatter={(l) => `Année ${l}`}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                    <Line
                      type="monotone"
                      dataKey="Patrimoine ACHAT"
                      stroke="#047857"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5, fill: '#047857' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="Patrimoine LOCATION"
                      stroke="#C2410C"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5, fill: '#C2410C' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {/* SENSITIVITY TABLE */}
          <section className="mb-14">
            <div className="mb-6">
              <h2 className="display-font italic text-[26px] text-stone-700 mb-1">Sensibilité</h2>
              <p className="text-[12px] text-stone-500">
                Patrimoine LOCATION à 20 ans (k€) selon discipline d'investissement × rendement portefeuille.
              </p>
            </div>

            <div className="bg-white/60 border border-stone-200/80 rounded-lg overflow-hidden">
              <table className="w-full text-[12px] mono-font tabular-nums">
                <thead>
                  <tr className="bg-stone-100/80 border-b border-stone-200">
                    <th className="text-left p-3 text-[10px] tracking-widest uppercase text-stone-500 font-medium">
                      Disc. ↓ / Rdt. →
                    </th>
                    {rendements.map((r) => (
                      <th key={r} className="p-3 text-stone-700 font-medium text-center">
                        {(r * 100).toFixed(0)} %
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {disciplines.map((d, i) => (
                    <tr key={d} className="border-b border-stone-200/50 last:border-0">
                      <td className="p-3 bg-stone-100/50 text-stone-700 font-medium text-center">
                        {(d * 100).toFixed(0)} %
                      </td>
                      {sensiTable[i].map((v, j) => {
                        const achat20 = Math.round(synthese[3].achat / 1000);
                        const isWin = v > achat20;
                        return (
                          <td
                            key={j}
                            className={`p-3 text-center ${
                              isWin ? 'text-orange-700' : 'text-stone-500'
                            } ${d === params.discipline && rendements[j] === params.rendement ? 'bg-amber-100 font-bold' : ''}`}
                          >
                            {v.toLocaleString('fr-FR')}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-3 bg-stone-50/50 border-t border-stone-200 text-[11px] text-stone-500 italic flex items-center gap-3 flex-wrap">
                <span><span className="inline-block w-3 h-3 bg-amber-100 rounded mr-1.5 align-middle border border-amber-200"></span>Vos paramètres actuels</span>
                <span><span className="text-orange-700 font-bold">orange</span> = Location bat l'achat à 20 ans ({fmtEur(synthese[3].achat)})</span>
              </div>
            </div>
          </section>

          {/* INTERPRETATION */}
          <section className="mb-14">
            <div className="bg-stone-900 text-stone-100 rounded-lg p-7 lg:p-10">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div>
                  <div className="text-[10px] tracking-[0.3em] text-orange-400 mono-font uppercase mb-3">Interprétation</div>
                  <h3 className="display-font text-[26px] leading-tight font-medium mb-4">
                    Ce que disent <span className="italic text-orange-400">vraiment</span> ces chiffres
                  </h3>
                  <div className="space-y-3 text-[13px] leading-relaxed text-stone-300">
                    <p>
                      Le <span className="text-orange-400 font-medium">ratio prix / loyer</span> ({model.ratioPrixLoyer.toFixed(1)}) est le premier indicateur. Sous 15, l'achat est presque toujours rationnel ; au-dessus de 25, la location avec investissement discipliné gagne mathématiquement.
                    </p>
                    <p>
                      La <span className="text-orange-400 font-medium">discipline d'investissement</span> est le facteur le plus sensible. Si vous savez que vous n'investirez pas réellement la différence chaque mois, l'achat redevient gagnant grâce à l'épargne forcée du crédit.
                    </p>
                    <p>
                      L'<span className="text-orange-400 font-medium">apport optimal</span> minimise la dette tout en gardant un capital qui travaille en bourse. Plus l'écart entre votre rendement de placement et votre taux de crédit est grand, moins vous devriez apporter.
                    </p>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] tracking-[0.3em] text-orange-400 mono-font uppercase mb-3">À tester</div>
                  <h3 className="display-font text-[26px] leading-tight font-medium mb-4">
                    Quatre scenarios <span className="italic text-orange-400">qui changent tout</span>
                  </h3>
                  <ul className="space-y-3 text-[13px] leading-relaxed text-stone-300">
                    <li className="flex gap-3">
                      <span className="mono-font text-orange-400 shrink-0">→</span>
                      <span>Mettez la <span className="text-stone-100">discipline à 30 %</span> — observez l'achat reprendre l'avantage.</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="mono-font text-orange-400 shrink-0">→</span>
                      <span>Réduisez l'<span className="text-stone-100">apport à 200 k€</span> — l'effet de levier maximal.</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="mono-font text-orange-400 shrink-0">→</span>
                      <span>Passez l'<span className="text-stone-100">appréciation à 3 %/an</span> (Aix tendu) — l'achat se relance.</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="mono-font text-orange-400 shrink-0">→</span>
                      <span>Testez un <span className="text-stone-100">rendement à 7 %</span> (S&P 500 historique) — la location creuse l'écart.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {/* DISCLAIMER */}
          <footer className="border-t border-stone-300/60 pt-8 mt-14">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-[11px] text-stone-500">
              <div>
                <div className="text-[10px] tracking-[0.2em] mono-font uppercase text-stone-700 font-semibold mb-2">Disclaimer</div>
                <p className="leading-relaxed">
                  Cet outil est fourni à titre <span className="italic">pédagogique uniquement</span>. Il ne constitue ni un conseil en investissement, ni une recommandation patrimoniale ou immobilière. Pour un conseil personnalisé, consultez un professionnel agréé (notaire, CGP, courtier).
                </p>
              </div>
              <div>
                <div className="text-[10px] tracking-[0.2em] mono-font uppercase text-stone-700 font-semibold mb-2">Méthodologie</div>
                <p className="leading-relaxed">
                  Modèle de cash-flow année par année avec capitalisation des portefeuilles d'investissement. Plus-value sur résidence principale considérée exonérée. Frais de transaction (notaire, agence) intégrés. Le patrimoine net inclut équité immobilière et portefeuille financier.
                </p>
              </div>
              <div>
                <div className="text-[10px] tracking-[0.2em] mono-font uppercase text-stone-700 font-semibold mb-2">Limites</div>
                <p className="leading-relaxed">
                  Hypothèses de rendement déterministes (pas de volatilité simulée). Pas de prise en compte de l'inflation générale dans la valorisation des flux. Fiscalité simplifiée. Les marchés financiers comme immobiliers comportent des risques de perte en capital.
                </p>
              </div>
            </div>
            <div className="text-[10px] mono-font tracking-widest text-stone-400 uppercase mt-8 text-center">
              · simulateur achat vs location · v 1.0 · 2026 ·
            </div>
          </footer>
        </main>
      </div>
    </>
  );
}
