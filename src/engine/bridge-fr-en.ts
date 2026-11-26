/**
 * French narration ↔ English comics: a small fixed bridge, no AI.
 * 1. Cognates are matched by their common stem (octobre ↔ october,
 *    photo ↔ photograph, intrinsèque ↔ intrinsic): first 5 letters.
 * 2. A glossary of the words American comics use all the time, so
 *    "son père, la guerre, dans la neige" finds "father, war, snow".
 * Everything is normalised: lower case, no accents.
 */

const RAW: Record<string, string> = {
  // people and family
  pere: 'father dad papa', mere: 'mother mom mama', fils: 'son boy', fille: 'daughter girl', enfant: 'child kid boy girl', enfants: 'children kids',
  frere: 'brother', soeur: 'sister', femme: 'woman wife', mari: 'husband', homme: 'man', hommes: 'men', ami: 'friend', amie: 'friend', amis: 'friends',
  ennemi: 'enemy', ennemis: 'enemies', heros: 'hero heroes', mechant: 'villain', dieu: 'god', dieux: 'gods', roi: 'king', reine: 'queen',
  soldat: 'soldier', soldats: 'soldiers', gens: 'people', peuple: 'people', famille: 'family', bebe: 'baby', vieux: 'old', jeune: 'young',
  // war, crime, action
  guerre: 'war', bataille: 'battle', combat: 'fight battle', tuer: 'kill', tue: 'kill killed', mort: 'death dead die', morte: 'dead', meurt: 'dies dying',
  arme: 'gun weapon', armes: 'guns weapons', fusil: 'rifle gun', bombe: 'bomb', explosion: 'explosion blast', chars: 'tanks', char: 'tank',
  allemands: 'german germans nazis', allemand: 'german', nazis: 'nazis', police: 'police cops', crime: 'crime', prison: 'prison jail',
  sang: 'blood', peur: 'fear afraid scared', danger: 'danger', sauver: 'save', proteger: 'protect', fuir: 'run escape flee', fuient: 'run escape',
  cacher: 'hide', cache: 'hide hidden', vol: 'fly flight steal', voler: 'fly steal', frapper: 'hit punch', attaque: 'attack',
  // time
  temps: 'time', heure: 'hour', heures: 'hours', jour: 'day', jours: 'days', nuit: 'night', matin: 'morning', soir: 'evening night',
  annee: 'year', annees: 'years', ans: 'years', siecle: 'century', passe: 'past', futur: 'future', avenir: 'future', present: 'present now',
  janvier: 'january', fevrier: 'february', mars: 'march mars', avril: 'april', mai: 'may', juin: 'june', juillet: 'july', aout: 'august',
  septembre: 'september', octobre: 'october', novembre: 'november', decembre: 'december', toujours: 'always forever', jamais: 'never',
  // places and things
  maison: 'home house', ville: 'city town', rue: 'street', monde: 'world', terre: 'earth', lune: 'moon', soleil: 'sun', etoiles: 'stars', espace: 'space',
  ciel: 'sky', mer: 'sea', neige: 'snow', pluie: 'rain', feu: 'fire', eau: 'water', foret: 'forest woods', route: 'road', routes: 'roads',
  charrette: 'wagon cart', voiture: 'car', train: 'train', bateau: 'boat ship', avion: 'plane', laboratoire: 'lab laboratory', labo: 'lab',
  montre: 'watch', montres: 'watches', horloge: 'clock', horloger: 'watchmaker', engrenages: 'gears', photo: 'photo photograph picture',
  bijoux: 'jewelry', argent: 'money silver', or: 'gold', cle: 'key', porte: 'door', boite: 'box', livre: 'book', lettre: 'letter',
  // body, mind, feelings
  coeur: 'heart', yeux: 'eyes', main: 'hand', mains: 'hands', visage: 'face', corps: 'body', esprit: 'mind spirit', ame: 'soul',
  amour: 'love', aime: 'love loved', aimer: 'love', aimait: 'loved', haine: 'hate', colere: 'anger angry', triste: 'sad', seul: 'alone', seule: 'alone',
  verite: 'truth', mensonge: 'lie', reve: 'dream', souvenir: 'memory remember', souvient: 'remember remembers', oublier: 'forget', savoir: 'know',
  croit: 'think believe', pense: 'think', voit: 'sees see', regarder: 'look watch', ecouter: 'listen', parler: 'talk speak', dit: 'says said',
  // power, science, cosmic
  pouvoir: 'power', pouvoirs: 'powers', force: 'strength force strong', atome: 'atom', atomes: 'atoms', energie: 'energy', realite: 'reality',
  univers: 'universe', dimension: 'dimension', accident: 'accident', experience: 'experiment', champ: 'field', chambre: 'chamber room',
  science: 'science', scientifique: 'scientist', physicien: 'physicist', bleu: 'blue', rouge: 'red', noir: 'black dark', lumiere: 'light',
  // verbs of story
  rentrer: 'home go back', ramener: 'take back home', partir: 'leave go', revenir: 'come back return', reparer: 'fix repair', construire: 'build',
  detruire: 'destroy', changer: 'change', devenir: 'become', perdre: 'lose lost', gagner: 'win', aider: 'help', attendre: 'wait', mourir: 'die',
  enferme: 'trapped locked', piege: 'trapped trap', bruit: 'noise sound', silence: 'quiet silence',
};

const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export const GLOSSARY: Map<string, string[]> = new Map(Object.entries(RAW).map(([k, v]) => [k, v.split(' ').map(norm)]));

/** English words a normalised French word may stand for (empty when unknown) */
export const translations = (n: string): string[] => GLOSSARY.get(n) ?? GLOSSARY.get(n.replace(/s$/, '')) ?? [];

/** common stem of a cognate pair: the first 5 letters of words of 6+ letters */
export const stem = (n: string): string | null => (n.length >= 6 && !/^\d+$/.test(n) ? n.slice(0, 5) : null);
