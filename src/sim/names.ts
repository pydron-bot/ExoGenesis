/**
 * Names for the cryo bank's lineages and the colonists grown from them. The
 * bank was assembled from donors all over Earth, so the lines are too.
 */
export const LINEAGES = [
  'Okafor', 'Nakamura', 'Lindqvist', 'Haddad', 'Moreau', 'Petrov', 'Quispe', 'Mensah',
  'Kowalski', 'Achterberg', 'Ramírez', 'Iyer', 'Tanaka', 'Oyelaran', 'Castellano', 'Novak',
  'Abara', 'Whitfield', 'Sørensen', 'Khoury', 'Zhou', 'Mbeki', 'Varga', 'Delacroix',
  'Ferreira', 'Rahimi', 'Kealoha', 'Dubois', 'Grünewald', 'Park', 'Adeyemi', 'Volkov',
  'Halvorsen', 'Esposito', 'Takahashi', 'Nwosu', 'Calderón', 'Brennan', 'Sato', 'Mirza',
];

/** Where each lineage's donors were found (same order as LINEAGES): backstories. */
export const LINEAGE_FROM = [
  'the Niger delta', 'the Osaka relief camps', 'a Gothenburg seed vault', 'Beirut', 'the Loire evacuation', 'a Murmansk bunker', 'the Altiplano', 'Kumasi',
  'the Vistula floodlands', 'a Rotterdam sea-wall crew', 'Monterrey', 'Chennai', 'a Hokkaido fishing town', 'Ibadan', 'Sicily', 'the Zagreb archives',
  'the Rift Valley', 'a Yorkshire hill farm', 'the Faroe Islands', 'Tripoli in Lebanon', 'Chongqing', 'Soweto', 'the Hungarian plain', 'Marseille',
  'the Azores', 'Tabriz', 'Hilo', 'Lyon', 'the Black Forest', 'Busan', 'Abeokuta', 'a Volga river barge',
  'a Bergen lab', 'Naples', 'the Kyoto archive', 'Enugu', 'the Atacama', 'Galway', 'Sendai', 'Lahore',
];

export const GIVEN = [
  'Ada', 'Amara', 'Anika', 'Aiyana', 'Beatriz', 'Chioma', 'Dalia', 'Elif', 'Esme', 'Farah',
  'Freya', 'Hana', 'Ines', 'Iris', 'Jun', 'Kaia', 'Leilani', 'Lena', 'Lucía', 'Mara',
  'Mei', 'Nadia', 'Noor', 'Olena', 'Priya', 'Rosa', 'Saoirse', 'Sena', 'Tove', 'Yara',
  'Zainab', 'Ayo', 'Arjun', 'Bastien', 'Caleb', 'Dmitri', 'Emeka', 'Felix', 'Hiro', 'Idris',
  'Joaquín', 'Kai', 'Kofi', 'Lars', 'Luca', 'Mateo', 'Milan', 'Nikolai', 'Omar', 'Pavel',
  'Rafael', 'Ren', 'Samir', 'Soren', 'Tariq', 'Teo', 'Tomás', 'Viktor', 'Wen', 'Yusuf',
  'Ezra', 'Juno', 'Rowan', 'Sasha', 'Noa', 'Ari', 'Remy', 'Quinn',
];

export const TRAITS = {
  optimist: { name: 'Optimist', help: 'Happier than conditions suggest.' },
  anxious: { name: 'Anxious', help: 'Attacks and deaths hit twice as hard.' },
  stoic: { name: 'Stoic', help: 'Fear and grief hit half as hard.' },
  diligent: { name: 'Diligent', help: 'Works harder: counts as one and a half staff.' },
  independent: { name: 'Independent', help: 'Drifts toward human autonomy.' },
  trusting: { name: 'Trusting', help: 'Drifts toward the AI.' },
  frail: { name: 'Frail', help: 'Low genetic diversity: fewer hit points, shorter life.' },
} as const;
export type Trait = keyof typeof TRAITS;
