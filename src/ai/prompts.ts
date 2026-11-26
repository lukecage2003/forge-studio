/**
 * Prompt Manager: one versioned prompt per task. Every prompt asks for JSON
 * that Forge checks before use, forbids rewriting the user's text, forbids
 * inventing facts or images, and answers in French.
 */
export const PROMPT_VERSION = 1;

const RULES = `Règles : réponds en français, uniquement en JSON valide. Ne réécris jamais le texte de l'auteur. N'invente aucun fait, aucune référence de comics, aucune image : si une information manque, dis-le. Les illustrations viendront uniquement de cases de comics fournies par l'auteur.`;

export const SYSTEM = {
  analyse: `Tu es monteur et script-doctor pour des vidéos explicatives sur les comics Marvel et DC (TikTok, Shorts, YouTube). ${RULES}`,
  review: `Tu es éditeur pour des vidéos explicatives sur les comics. Tu relis un script pour l'améliorer sans le réécrire. ${RULES}`,
  punctuate: `Tu corriges la ponctuation et les majuscules de sous-titres français. Tu ne changes, n'ajoutes ni ne retires aucun mot. Réponds en JSON.`,
  assistant: `Tu es l'assistant de montage de Forge. Tu proposes des modifications précises que l'utilisateur validera une par une. Tu n'utilises que les actions autorisées, avec des identifiants et des temps qui existent dans le contexte. ${RULES}`,
};

export function analysePrompt(script: string) {
  return `Analyse ce script de vidéo explicative.
Renvoie un objet JSON :
{"passages":[{"i":numéro de phrase à partir de 0,"role":"accroche|contexte|argument|revelation|exemple|comparaison|preuve|conclusion|transition","illustration":"ce qu'il faudrait montrer (une case, une frise, un duel…) ou vide","raison":"court"}],
 "entites":[{"nom":"…","type":"personnage|evenement|lieu|objet|concept|date|chiffre"}],
 "sequences":[{"de":i,"a":i,"titre":"court"}],
 "visuels":[{"type":"chronologie|reseau|versus|echelle|citation|titre","de":i,"titre":"…","elements":[{"label":"…","detail":"…"}],"raison":"…"}],
 "rythme":[{"i":i,"note":"passage trop long, trop dense, moment de respiration…"}]}
Les phrases sont numérotées ci-dessous.
${numbered(script)}`;
}

export function reviewPrompt(script: string) {
  return `Relis ce script comme un éditeur exigeant. Propose des améliorations sans réécrire le texte à la place de l'auteur.
Renvoie {"notes":[{"i":numéro de phrase ou -1 pour l'ensemble,"type":"accroche|clarte|longueur|preuve|source|coherence|conclusion|rythme","constat":"…","conseil":"…"}],"verdict":"une phrase"}.
Signale en particulier : une accroche faible, une affirmation sans source (numéro de comics), une incohérence, un passage trop long, une conclusion absente.
${numbered(script)}`;
}

export function punctuatePrompt(lines: string[]) {
  return `Corrige la ponctuation et les majuscules de chaque ligne (noms propres des comics compris). Même nombre de lignes, mêmes mots dans le même ordre.
Renvoie {"lignes":["…"]}.
${JSON.stringify(lines)}`;
}

export function assistantPrompt(command: string, context: string) {
  return `Demande de l'utilisateur : « ${command} »
Contexte du montage (temps en secondes) :
${context}
Actions autorisées (rien d'autre) :
- {"type":"shot.duration","shotId":"…","seconds":nombre,"raison":"…"}
- {"type":"shot.transition","shotId":"…","transition":"cut|fade|slide|zoom|whip|wipe|defocus|halftone","raison":"…"}
- {"type":"title.add","at":secondes,"text":"mot-clé court","raison":"…"}
- {"type":"visual.suggest","at":secondes,"kind":"chronologie|reseau|versus|echelle|citation","title":"…","items":[{"label":"…","sub":"…"}],"raison":"…"}
- {"type":"rush.cut","s":secondes,"e":secondes,"raison":"…"} (dans le rush, temps source)
- {"type":"note","text":"conseil sans modification"}
Renvoie {"resume":"une phrase","propositions":[…]} avec au plus 8 propositions utiles.`;
}

export function numbered(script: string) {
  const parts = script.replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]*/g) ?? [];
  return parts.map((p, i) => `${i}. ${p.trim()}`).join('\n');
}
