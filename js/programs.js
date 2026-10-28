// Egne styrkeprogrammer: pas-skabeloner (øvelser, sæt, reps, RIR, pause) og et ugemønster.
// Rene funktioner uden DOM. Et aktivt program erstatter planens styrkepas fra en valgt dato og frem – gamle logs røres ikke.
import * as P from './plan.js';

export const LEG_VOLUMES = [['low', 'Lav'], ['normal', 'Normal'], ['high', 'Høj']];
export const ADAPT_OPTIONS = [['0', 'Ingen'], ['2', '2 uger'], ['3', '3 uger']];
export const WEEKDAYS = [[1, 'Mandag'], [2, 'Tirsdag'], [3, 'Onsdag'], [4, 'Torsdag'], [5, 'Fredag'], [6, 'Lørdag'], [0, 'Søndag']];
export const MIN_PER_WEEK = 3, MAX_PER_WEEK = 5;

const ex = (exercise, sets, reps, rir, rest_sec) => ({ exercise, sets, reps, rir, ...(rest_sec ? { rest_sec } : {}) });
// Indbygget forslag: dit gamle program (navne som i øvelsesbiblioteket)
export const BUILTIN = {
  id: 'upper-lower-ab',
  name: 'Upper A / Lower A / Upper B / Lower B',
  leg_volume: 'normal',
  adapt_weeks: 0,
  sessions: [
    { id: 'upperA', name: 'Upper A', kind: 'upper', exercises: [
      ex('Bænkpres', 3, '6-10', '2', 150), ex('Pull-ups med vægt / lat pulldown', 3, '6-10', '2', 150), ex('Rows med støtte til brystet', 3, '8-12', '2', 120),
      ex('Siddende DB-skulderpres', 3, '8-12', '2', 120), ex('Enarms lateral raise i kabel', 3, '12-15', '1'), ex('Biceps curl med håndvægte', 3, '10-12', '1'), ex('Rebpushdown', 3, '10-12', '1')] },
    { id: 'lowerA', name: 'Lower A', kind: 'lower', exercises: [
      ex('Squat (eller hack squat)', 3, '6-8', '2', 180), ex('Rumænsk dødløft', 3, '8-10', '2', 150), ex('Benpres (leg press)', 3, '10-12', '2', 120),
      ex('Liggende leg curl', 3, '10-12', '1'), ex('Stående lægløft', 3, '12-15', '1'), ex('Kabel-crunch', 3, '12-15', '1')] },
    { id: 'upperB', name: 'Upper B', kind: 'upper', exercises: [
      ex('Incline DB-pres', 3, '8-10', '2', 150), ex('Lat pulldown', 3, '8-12', '2', 120), ex('Siddende kabelroning', 3, '8-12', '2', 120), ex('Brystpres i maskine', 3, '10-12', '1', 120),
      ex('Lateral raises (kabel eller DB)', 3, '12-15', '1'), ex('Omvendt butterfly (reverse pec deck)', 3, '12-15', '1'), ex('Preacher curl', 3, '10-12', '1'), ex('Overhead triceps extension (kabel)', 3, '10-12', '1')] },
    { id: 'lowerB', name: 'Lower B', kind: 'lower', exercises: [
      ex('Hack squat (maskine)', 3, '8-10', '2', 150), ex('Bulgarsk split squat', 3, '8-10', '2', 120), ex('Leg extension', 3, '10-12', '1'),
      ex('Siddende leg curl', 3, '10-12', '1'), ex('Siddende lægløft', 3, '12-15', '1'), ex('Hanging leg raises / ab wheel', 3, '10-15', '1')] },
  ],
  pattern: { 1: 'lowerA', 2: 'upperA', 4: 'lowerB', 6: 'upperB' },
};

// Indbygget forslag: Hybrid 4-split (Lower er løberens dag; Bryst & ryg mandag, Lower onsdag, Skulder & arm + løberstyrke torsdag, Upper fredag)
export const HYBRID = {
  id: 'hybrid-4-split',
  name: 'Hybrid 4-split',
  leg_volume: 'normal',
  adapt_weeks: 0,
  sessions: [
    { id: 'bryst', name: 'Bryst & ryg', kind: 'upper', exercises: [
      ex('Incline DB-pres', 4, '8-10', '1-2', 150), ex('Barbell- eller T-bar-row', 4, '8-10', '1-2', 150), ex('Dips (evt. med vægt)', 3, '8-12', '1-2', 120),
      ex('Lat pulldown med neutralt greb', 3, '10-12', '1-2', 120), ex('Cable fly (lav → høj)', 3, '12-15', '1-2'), ex('Straight-arm pulldown', 2, '12-15', '1-2')] },
    { id: 'lower', name: 'Lower', kind: 'lower', exercises: [
      ex('Squat (eller hack squat)', 4, '3-6', '1-2', 180), ex('Bulgarsk split squat', 3, '6-8 pr. ben', '1-2', 120), ex('Rumænsk dødløft', 3, '6-8', '1-2', 150),
      ex('Stående lægløft', 3, '8-12', '1-2'), ex('Siddende lægløft', 3, '10-15', '1-2')] },
    { id: 'skulder', name: 'Skulder & arm', kind: 'upper', exercises: [
      ex('Siddende DB-skulderpres', 3, '8-10', '1-2', 120), ex('Lateral raises (kabel eller DB)', 4, '12-20', '1-2'), ex('Rear delt fly / face pulls', 3, '15-20', '1-2'),
      ex('EZ-bar curl', 3, '8-12', '1-2'), ex('Overhead triceps extension (kabel)', 3, '10-12', '1-2'), ex('Hammer curl + pushdown (superset)', 2, '12-15', '1-2'),
      ex('Side plank', 2, '30-40 sek', '3'), ex('Copenhagen adduktor', 2, '20-30 sek', '3'), ex('Dead bug', 2, '8-10 pr. side', '3'), ex('Tibialis-løft', 2, '15-20', '3')] },
    { id: 'upper', name: 'Upper (styrke)', kind: 'upper', exercises: [
      ex('Bænkpres', 4, '5-7', '1-2', 150), ex('Pull-ups med vægt / lat pulldown', 4, '6-8', '1-2', 150), ex('Stående skulderpres', 3, '6-8', '1-2', 150),
      ex('Rows med støtte til brystet', 3, '8-10', '1-2', 120), ex('Incline DB curl + rebpushdown (superset)', 2, '10-12', '1-2')] },
  ],
  pattern: { 1: 'bryst', 3: 'lower', 4: 'skulder', 5: 'upper' },
};
// <ulu>
// Indbygget forslag: Hybrid U/L/U (3 styrkepas: Upper man, Lower ons, Upper fre). Genereres af scripts/restructure_plan.py – ret ikke i hånden.
export const HYBRID_ULU = {
  "id": "hybrid-ulu",
  "name": "Hybrid U/L/U",
  "leg_volume": "normal",
  "adapt_weeks": 0,
  "sessions": [
    {
      "id": "umon",
      "name": "Upper (mandag)",
      "kind": "upper",
      "exercises": [
        {
          "exercise": "Bænkpres",
          "sets": 3,
          "reps": "5-8",
          "rir": "1-2",
          "rest_sec": 150
        },
        {
          "exercise": "Lat pulldown",
          "sets": 3,
          "reps": "6-10",
          "rir": "1-2",
          "rest_sec": 120
        },
        {
          "exercise": "Incline DB-pres",
          "sets": 3,
          "reps": "8-10",
          "rir": "1-2",
          "rest_sec": 120
        },
        {
          "exercise": "Siddende kabelroning",
          "sets": 3,
          "reps": "8-12",
          "rir": "1-2",
          "rest_sec": 120
        },
        {
          "exercise": "Siddende DB-skulderpres",
          "sets": 2,
          "reps": "8-10",
          "rir": "1-2",
          "rest_sec": 120
        },
        {
          "exercise": "Enarms lateral raise i kabel",
          "sets": 3,
          "reps": "12-20",
          "rir": "1-2",
          "rest_sec": 60
        },
        {
          "exercise": "EZ-bar curl",
          "sets": 2,
          "reps": "8-12",
          "rir": "1-2",
          "rest_sec": 75
        },
        {
          "exercise": "Rebpushdown",
          "sets": 2,
          "reps": "8-12",
          "rir": "1-2",
          "rest_sec": 75
        }
      ],
      "note": "Upper (8 øvelser, ens mandag og fredag). Skulderpres, curl og pushdown: 2–3 sæt. Falder reps mod mandag, er det ugetræthed – hold samme vægt."
    },
    {
      "id": "lower",
      "name": "Lower",
      "kind": "lower",
      "exercises": [
        {
          "exercise": "Squat (eller hack squat)",
          "sets": 3,
          "reps": "4-6",
          "rir": "2-3",
          "rest_sec": 150
        },
        {
          "exercise": "Rumænsk dødløft",
          "sets": 3,
          "reps": "6-8",
          "rir": "2-3",
          "rest_sec": 120
        },
        {
          "exercise": "Bulgarsk split squat",
          "sets": 2,
          "reps": "6-8 pr. ben",
          "rir": "2-3",
          "rest_sec": 120
        },
        {
          "exercise": "Stående lægløft",
          "sets": 3,
          "reps": "8-12",
          "rir": "2-3",
          "rest_sec": 75
        },
        {
          "exercise": "Siddende lægløft",
          "sets": 2,
          "reps": "12-15",
          "rir": "2-3",
          "rest_sec": 75
        }
      ],
      "note": "Løberens dag. Squat eksplosivt op (alternativ: trapbar-dødløft). Stående og siddende lægløft som supersæt."
    },
    {
      "id": "core",
      "name": "Core & mobilitet",
      "kind": "core",
      "exercises": [
        {
          "exercise": "Hanging leg raises / ab wheel",
          "sets": 3,
          "reps": "8-12",
          "rir": "",
          "rest_sec": 60
        },
        {
          "exercise": "Kabel-crunch",
          "sets": 3,
          "reps": "10-15",
          "rir": "",
          "rest_sec": 60
        },
        {
          "exercise": "Side plank",
          "sets": 2,
          "reps": "30-45 sek pr. side",
          "rir": "",
          "rest_sec": 45
        },
        {
          "exercise": "Pallof press",
          "sets": 2,
          "reps": "10 pr. side",
          "rir": "",
          "rest_sec": 45
        },
        {
          "exercise": "Udstrækning: hoftebøjere",
          "sets": 1,
          "reps": "45 sek pr. side",
          "rir": ""
        },
        {
          "exercise": "Udstrækning: lægge",
          "sets": 1,
          "reps": "45 sek pr. side",
          "rir": ""
        },
        {
          "exercise": "Udstrækning: baglår",
          "sets": 1,
          "reps": "45 sek pr. side",
          "rir": ""
        },
        {
          "exercise": "Udstrækning: bryst",
          "sets": 1,
          "reps": "45 sek pr. side",
          "rir": ""
        }
      ],
      "note": "Let pas (15–20 min) efter den rolige tur – tæller ikke som benpas eller hård dag. Hjemme: dead bug i stedet for crunch/leg raise, fuglehund i stedet for Pallof press. Afslut med 5–8 min udstrækning (afkryds)."
    },
    {
      "id": "ufri",
      "name": "Upper (fredag)",
      "kind": "upper",
      "exercises": [
        {
          "exercise": "Bænkpres",
          "sets": 3,
          "reps": "5-8",
          "rir": "1-2",
          "rest_sec": 150
        },
        {
          "exercise": "Lat pulldown",
          "sets": 3,
          "reps": "6-10",
          "rir": "1-2",
          "rest_sec": 120
        },
        {
          "exercise": "Incline DB-pres",
          "sets": 3,
          "reps": "8-10",
          "rir": "1-2",
          "rest_sec": 120
        },
        {
          "exercise": "Siddende kabelroning",
          "sets": 3,
          "reps": "8-12",
          "rir": "1-2",
          "rest_sec": 120
        },
        {
          "exercise": "Siddende DB-skulderpres",
          "sets": 2,
          "reps": "8-10",
          "rir": "1-2",
          "rest_sec": 120
        },
        {
          "exercise": "Enarms lateral raise i kabel",
          "sets": 3,
          "reps": "12-20",
          "rir": "1-2",
          "rest_sec": 60
        },
        {
          "exercise": "EZ-bar curl",
          "sets": 2,
          "reps": "8-12",
          "rir": "1-2",
          "rest_sec": 75
        },
        {
          "exercise": "Rebpushdown",
          "sets": 2,
          "reps": "8-12",
          "rir": "1-2",
          "rest_sec": 75
        }
      ],
      "note": "Upper (8 øvelser, ens mandag og fredag). Skulderpres, curl og pushdown: 2–3 sæt. Falder reps mod mandag, er det ugetræthed – hold samme vægt."
    }
  ],
  "pattern": {
    "1": "umon",
    "3": "lower",
    "4": "core",
    "5": "ufri"
  },
  "phases": [
    {
      "from": "2026-11-02",
      "to": "2026-11-15",
      "cap": 2,
      "rir_upper": "2-3",
      "rir_lower": "3"
    },
    {
      "from": "2026-11-16",
      "to": "2026-11-22",
      "cap": 3
    },
    {
      "from": "2026-11-23",
      "to": "2026-11-29",
      "cap": 2,
      "rir_upper": "3",
      "rir_lower": "3"
    },
    {
      "from": "2026-11-30",
      "to": "2026-12-06",
      "cap": 3
    },
    {
      "from": "2026-12-07",
      "to": "2026-12-20",
      "cap": 3,
      "swap": {
        "Bulgarsk split squat": {
          "exercise": "Step-downs fra kasse (3 sek ned, excentrisk)",
          "sets": 2,
          "reps": "8 pr. ben",
          "rir": "2-3",
          "rest_sec": 120
        }
      }
    },
    {
      "from": "2026-12-21",
      "to": "2026-12-27",
      "cap": 2,
      "swap": {
        "Bulgarsk split squat": {
          "exercise": "Step-downs fra kasse (3 sek ned, excentrisk)",
          "sets": 2,
          "reps": "8 pr. ben",
          "rir": "2-3",
          "rest_sec": 120
        }
      },
      "rir_upper": "3",
      "rir_lower": "3"
    },
    {
      "from": "2026-12-28",
      "to": "2027-01-17",
      "cap": 3,
      "swap": {
        "Bulgarsk split squat": {
          "exercise": "Step-downs fra kasse (3 sek ned, excentrisk)",
          "sets": 2,
          "reps": "8 pr. ben",
          "rir": "2-3",
          "rest_sec": 120
        }
      }
    },
    {
      "from": "2027-01-18",
      "to": "2027-01-24",
      "cap": 2,
      "swap": {
        "Bulgarsk split squat": {
          "exercise": "Step-downs fra kasse (3 sek ned, excentrisk)",
          "sets": 2,
          "reps": "8 pr. ben",
          "rir": "2-3",
          "rest_sec": 120
        }
      },
      "rir_upper": "3",
      "rir_lower": "3"
    },
    {
      "from": "2027-01-25",
      "to": "2027-02-14",
      "cap": 3,
      "swap": {
        "Bulgarsk split squat": {
          "exercise": "Step-downs fra kasse (3 sek ned, excentrisk)",
          "sets": 2,
          "reps": "8 pr. ben",
          "rir": "2-3",
          "rest_sec": 120
        }
      }
    },
    {
      "from": "2027-02-15",
      "to": "2027-02-21",
      "factor": 0.5,
      "swap": {
        "Bulgarsk split squat": {
          "exercise": "Step-downs fra kasse (3 sek ned, excentrisk)",
          "sets": 2,
          "reps": "8 pr. ben",
          "rir": "2-3",
          "rest_sec": 120
        }
      },
      "rir_upper": "3",
      "rir_lower": "3"
    },
    {
      "from": "2027-02-22",
      "to": "2027-02-28",
      "factor": 0.5,
      "no_lower": true,
      "no_weekdays": [
        4,
        5
      ],
      "rir_upper": "3"
    },
    {
      "from": "2027-03-01",
      "to": "2027-03-07",
      "cap": 2,
      "no_lower": true,
      "rir_upper": "3"
    },
    {
      "from": "2027-03-08",
      "to": "2027-03-28",
      "cap": 3,
      "drop": [
        "Bulgarsk split squat"
      ],
      "lower_sets": {
        "Squat (eller hack squat)": 2,
        "Rumænsk dødløft": 2
      }
    },
    {
      "from": "2027-03-29",
      "to": "2027-04-04",
      "cap": 2,
      "drop": [
        "Bulgarsk split squat"
      ],
      "lower_sets": {
        "Squat (eller hack squat)": 2,
        "Rumænsk dødløft": 2
      },
      "rir_upper": "3",
      "rir_lower": "3"
    },
    {
      "from": "2027-04-05",
      "to": "2027-04-18",
      "cap": 3,
      "drop": [
        "Bulgarsk split squat"
      ],
      "lower_sets": {
        "Squat (eller hack squat)": 2,
        "Rumænsk dødløft": 2
      }
    },
    {
      "from": "2027-04-19",
      "to": "2027-05-02",
      "factor": 0.5,
      "drop": [
        "Bulgarsk split squat"
      ],
      "lower_sets": {
        "Squat (eller hack squat)": 2,
        "Rumænsk dødløft": 2
      },
      "rir_upper": "3",
      "rir_lower": "3"
    },
    {
      "from": "2027-05-03",
      "to": "2027-05-09",
      "factor": 0.5,
      "no_lower": true,
      "no_weekdays": [
        5
      ],
      "rir_upper": "3"
    }
  ]
};
// </ulu>
export const BUILTINS = [HYBRID_ULU, HYBRID, BUILTIN].filter(Boolean);

export const newId = (p = 'pg') => `${p}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
export const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- Ben-volumen ----------
// Lav: 1–2 sæt, Normal: som skrevet, Høj: +1 sæt
export function scaleSets(sets, vol) {
  const n = Math.max(1, Math.round(Number(sets) || 3));
  if (vol === 'low') return Math.max(1, Math.min(2, Math.round(n / 2)));
  if (vol === 'mid') return Math.max(2, n - 1);
  if (vol === 'high') return n + 1;
  return n;
}
// Tilvænning: de første uger lav volumen + RIR 3, stigende automatisk til det valgte niveau
export function legStage(program, session, date) {
  const chosen = session.leg_volume && session.leg_volume !== 'inherit' ? session.leg_volume : program.leg_volume || 'normal';
  const N = Number(program.adapt_weeks) || 0;
  const w = Math.floor(P.daysBetween(program.start_date, date) / 7);
  if (N > 0 && w >= 0 && w < N) {
    const ramp = N === 2 ? ['low', 'mid'] : ['low', 'mid', 'normal'];
    return { vol: ramp[w], rir3: true, adapting: true, week: w + 1, of: N };
  }
  return { vol: chosen, rir3: false, adapting: false };
}
export const volumeLabel = (v) => ({ low: 'Lav', mid: 'Let', normal: 'Normal', high: 'Høj' }[v] || v);

// ---------- Fra pas-skabelon til planens pas ----------
// Perioder i programmet (valgfrit): sæt-loft, halvering, RIR, udskiftede/udgåede øvelser, ingen Lower i løbsuger
const phaseOf = (program, date) => (program.phases || (program.builtin === 'hybrid-ulu' && HYBRID_ULU ? HYBRID_ULU.phases : null) || []).find((p) => p.from <= date && date <= p.to) || null;
export function buildItem(program, session, date) {
  const leg = session.kind === 'lower';
  const ph = phaseOf(program, date);
  if (ph && ((leg && ph.no_lower) || (ph.no_weekdays || []).includes(P.parseISO(date).getDay()))) return null;
  const stage = leg ? legStage(program, session, date) : null;
  const exercises = [];
  for (const x0 of session.exercises) {
    if (ph && (ph.drop || []).includes(x0.exercise)) continue;
    const x = ph && ph.swap && ph.swap[x0.exercise] ? ph.swap[x0.exercise] : x0;
    let sets = leg ? scaleSets(x.sets, stage.vol) : Math.max(1, Number(x.sets) || 3);
    if (ph) {
      if (leg && ph.lower_sets && ph.lower_sets[x0.exercise] != null) sets = ph.lower_sets[x0.exercise];
      if (ph.cap != null) sets = Math.min(sets, ph.cap);
      if (ph.factor != null) sets = Math.max(1, Math.floor(sets * ph.factor + 0.5));
    }
    let rir = String(x.rir ?? '2');
    const pr = ph && session.kind !== 'core' && (leg ? ph.rir_lower : ph.rir_upper);
    if (pr) rir = pr;
    if (stage && stage.rir3) rir = '3';
    const o = { exercise: x.exercise, sets, reps: String(x.reps || '8-12'), rir };
    if (Number(x.rest_sec) > 0) o.rest_sec = Number(x.rest_sec);
    exercises.push(o);
  }
  let note = session.note || '';
  if (ph && ph.factor != null) note = `${note} Nedtrapning/løbsuge: halve sæt, samme vægt.`.trim();
  if (stage && stage.adapting) note = `Tilvænning uge ${stage.week} af ${stage.of}: lav ben-volumen og RIR 3.`;
  const item = { kind: 'strength', session: session.name, exercises, note, program_id: program.id };
  if (leg) item.leg = true;
  if (session.kind === 'core') item.light = true;
  return item;
}

export function sessionsPerWeek(program) {
  return WEEKDAYS.filter(([d]) => program.pattern && program.pattern[d] && program.sessions.some((s) => s.id === program.pattern[d])).length;
}

// Læg programmet oven på planens uger fra startdatoen. Dage med race røres ikke. Andre pas (løb) bevares.
export function applyProgram(weeks, program) {
  if (!program || !program.start_date || !program.active) return weeks;
  const byId = new Map(program.sessions.map((s) => [s.id, s]));
  return weeks.map((w) => {
    if (w.days[6].date < program.start_date) return w;
    const days = w.days.map((d) => {
      if (d.date < program.start_date) return d;
      if (d.items.some((i) => i.kind === 'run' && i.type === 'race')) return d;
      const wd = P.parseISO(d.date).getDay();
      const keep = d.items.filter((i) => i.kind !== 'strength' && i.kind !== 'rest');
      const sid = program.pattern && program.pattern[wd];
      const s = sid && byId.get(sid);
      const built = s ? buildItem(program, s, d.date) : null;
      const items = !built ? keep : built.light ? [...keep, built] : [built, ...keep];
      return { ...d, items: items.length ? items : [{ kind: 'rest', description: 'Hviledag (gåtur/mobilitet er fint)' }] };
    });
    return { ...w, days };
  });
}

// Øvelser, der giver meget ømhed (excentrisk tunge): mærket kommer fra øvelsesbiblioteket (doms: true), ellers fra navnet
const DOMS_NAME = /rumænsk dødløft|\brdl\b|bulgarsk|split squat|step-down|nordic|gående udfald|baglæns udfald|good morning|dødløft/i;
export function givesSoreness(name, lib) {
  const e = lib && lib.get ? lib.get(name) : null;
  if (e && e.doms != null) return !!e.doms;
  return DOMS_NAME.test(name || '');
}

// Lille kontrol af et program (til visning i editoren)
export function programIssues(program) {
  const out = [];
  const n = sessionsPerWeek(program);
  if (n < MIN_PER_WEEK) out.push(`Kun ${n} pas pr. uge – vælg mindst ${MIN_PER_WEEK}.`);
  if (n > MAX_PER_WEEK) out.push(`${n} pas pr. uge er for mange – højst ${MAX_PER_WEEK}.`);
  for (const s of program.sessions) if (!s.exercises.length) out.push(`${s.name} har ingen øvelser.`);
  return out;
}
