// Tjeklister til løbene. Afkrydsninger gemmes i tabellen "checklists".
export const CHECKLISTS = [
  {
    id: 'tgc',
    title: 'Transgrancanaria Half',
    items: [
      { id: 'tgc-shoes', text: 'Trailsko afprøvet på mindst 2–3 langture' },
      { id: 'tgc-gear', text: 'Obligatorisk udstyr tjekket i racens reglement (transgrancanaria.net)' },
      { id: 'tgc-poles', text: 'Stavregler tjekket (må man bruge stave på Half?)' },
      { id: 'tgc-date', text: 'Racedato bekræftet (torsdag 25/2-2027) – løbsugen: shakeout tirsdag, hvile onsdag, intet styrke' },
      { id: 'tgc-fuel', text: 'Gel/væske-plan afprøvet på trail-langtur' },
      { id: 'tgc-downhill', text: 'Øvet nedløb på kuperede ture' },
      { id: 'tgc-travel', text: 'Fly, hotel og transport til start booket' },
      { id: 'tgc-bib', text: 'Startnummer-afhentning (tid og sted) noteret' },
    ],
  },
  {
    id: 'cph',
    title: 'CPH Marathon',
    items: [
      { id: 'cph-shoes', text: 'Racesko med 50–150 km i benene' },
      { id: 'cph-gel', text: 'Gelplan afprøvet på langture (hver 30–40 min)' },
      { id: 'cph-pace', text: 'Marathonmål og tempoer sat (efter 5 km-testen)' },
      { id: 'cph-carb', text: 'Carb-loading de sidste 2 dage før' },
      { id: 'cph-bib', text: 'Startnummer hentet' },
      { id: 'cph-clothes', text: 'Påklædning testet (også til regn/kulde)' },
      { id: 'cph-logistics', text: 'Transport til start og mødested efter målgang aftalt' },
    ],
  },
  {
    id: 'general',
    title: 'Generelt',
    items: [
      { id: 'gen-protein', text: 'Protein ca. 1,6–2 g pr. kg kropsvægt om dagen' },
      { id: 'gen-sleep', text: '7–9 timers søvn – også efter natflyvninger' },
      { id: 'gen-fuel', text: 'Energi med på langture over 90 min' },
    ],
  },
];
