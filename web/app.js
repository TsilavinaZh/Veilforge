'use strict';
const $ = id => document.getElementById(id);

const API_KEY = 'local-dev-key';
let demoBusy = false;
let demoSession = null;
let demoMasked = '';
let demoIndex = 0;
let demoEntities = [];

const labels = {
  EMAIL: 'Adresse e-mail', PHONE: 'Téléphone', PERSON: 'Personne',
  CREDIT_CARD: 'Carte bancaire', SECRET: 'Clé / secret',
  PASSWORD: 'Mot de passe', ADDRESS: 'Adresse postale',
  BANK_ACCOUNT: 'Compte bancaire', IBAN: 'IBAN',
  IP_ADDRESS: 'Adresse IP',
  DATE_OF_BIRTH: 'Date de naissance', NATIONAL_ID: 'Pièce d’identité'
};

const tokenPattern = /\[\[[A-Z][A-Z0-9_]*_\d+\]\]/g;

const DEMO_EXAMPLES = [
  'Bonjour, pouvez-vous envoyer le devis à claire.dubois@example.com avant vendredi ? ' +
  'Son numéro est +33 6 12 34 56 78 et le client est en copie sur pierre@atelier-lyon.fr. ' +
  'Carte de test : 4242 4242 4242 4242.',

  'Transfert de 1 250 € sur le compte FR76 3000 6000 0112 3456 7890 189 le 14/03/2026. ' +
  'Serveur : 10.0.0.42, identifiant passeport AB1234567. ' +
  'Mot de passe du compte : hush-dove-42-pass.',

  'Résumé du dossier : client nommé Jean Dupont, né le 12/07/1988, joignable au +261 34 12 345 67. ' +
  'Clé API : crm_9f2b7c1d4e6a8b0c1d2e3f4a5b6c7d8e. ' +
  'Merci de rappeler avant le 03/09/2026.',

  'Livraison au 24 rue des Oliviers, 69001 Lyon ; contact : samira.benali@exemple.fr, ' +
  'téléphone +33 4 78 12 34 56. Facture à envoyer à pierre@atelier-lyon.fr.',

  'Identifiants de test — mot de passe du VPN : Blue-River-77-Xk, pwd= staging_9f31ab77. ' +
  'Clé Git : ghp_ABCDEFGHijklmnopqrstuvwxyz123456, ' +
  'JWT : eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFubmFifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c.',

  'Virement du 14/03/2026 sur le compte n° 123456789012, RIB FR1420041010050500013M02606. ' +
  'Titulaire : Mme Claire Dubont, née le 12/07/1988, passeport AB1234567, joignable au +261 34 12 345 67.'
];

/* ── Chargement ─────────────────────────────────────────── */
function hideLoader() {
  const loader = $('loader');
  if (loader && !loader.classList.contains('is-done')) loader.classList.add('is-done');
}
window.addEventListener('load', hideLoader);
setTimeout(hideLoader, 4000);

/* ── Communication ──────────────────────────────────────── */
async function api(path, body, signal) {
  const response = await fetch('/api/v1/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_KEY },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal || AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('Clé API refusée par le service. Vérifiez VEILFORGE_API_KEY côté serveur.');
    if (response.status === 429) throw new Error('Trop de requêtes. Patientez une minute avant de réessayer.');
    throw new Error('Le service ne peut pas traiter cette demande (' + response.status + '). Réessayez.');
  }
  return response.json();
}

function errorMessage(error) {
  return error.name === 'TimeoutError' ? 'Le service met trop de temps à répondre. Réessayez.' :
    error instanceof TypeError ? 'Service inaccessible. Vérifiez que le serveur Veilforge est démarré.' : error.message;
}

/* Rend le texte protégé en nœuds de texte uniquement :
   le contenu utilisateur ne peut jamais devenir du HTML exécutable. */
function renderMasked(container, text) {
  container.classList.remove('empty');
  container.replaceChildren();
  const byToken = new Map(demoEntities.map(entity => [entity.placeholder, entity]));
  let cursor = 0;
  for (const match of text.matchAll(tokenPattern)) {
    container.append(document.createTextNode(text.slice(cursor, match.index)));
    const mark = document.createElement('mark');
    mark.textContent = match[0];
    const entity = byToken.get(match[0]);
    if (entity) {
      mark.tabIndex = 0;
      mark.dataset.tip = '1';
      mark.setAttribute('aria-label', tokenSummary(entity));
    }
    container.append(mark);
    cursor = match.index + match[0].length;
  }
  container.append(document.createTextNode(text.slice(cursor)));
}

/* Surbrillance des champs détectés dans le panneau « Texte original ».
   La couche .editor-marks reprend exactement le texte du textarea (mêmes
   métriques) : seuls les fonds des `<mark>` changent, jamais la mise en page. */
function renderInputMarks(text, entities) {
  const layer = $('demo-marks');
  if (!layer) return;
  const editor = layer.closest('.editor');
  if (editor) editor.classList.add('is-marked');
  layer.replaceChildren();
  const spans = (entities || [])
    .filter(entity => typeof entity.start === 'number' && text.slice(entity.start, entity.end) === entity.value)
    .sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const entity of spans) {
    if (entity.start < cursor) continue;
    layer.append(document.createTextNode(text.slice(cursor, entity.start)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(entity.start, entity.end);
    layer.append(mark);
    cursor = entity.end;
  }
  layer.append(document.createTextNode(text.slice(cursor)));
  if (text.endsWith('\n')) layer.append(document.createTextNode(' '));
}

/* ── Détail d'un champ masqué (survol ou focus) ────────── */
const SOURCES = { dictionary: 'dictionnaire', context: 'contexte', rules: 'règles' };

function tokenSummary(entity) {
  const label = labels[entity.type] || entity.type;
  return label + ' masquée : ' + (entity.value || 'valeur inconnue') +
    ', confiance ' + Math.round(entity.confidence * 100) + ' %';
}

function showTokenTip(mark) {
  const container = $('demo-output');
  const entity = demoEntities.find(item => item.placeholder === mark.textContent);
  if (!container || !entity) return;
  let tip = container.querySelector('.token-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'token-tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    container.append(tip);
  }
  tip.replaceChildren();
  const head = document.createElement('strong');
  head.textContent = labels[entity.type] || entity.type;
  const code = document.createElement('code');
  code.textContent = entity.placeholder;
  tip.append(head, code);
  for (const [key, value] of [
    ['Masque', entity.value || '—'],
    ['Confiance', Math.round(entity.confidence * 100) + ' %'],
    ['Source', SOURCES[entity.source] || entity.source || 'règles'],
    ['Empreinte', entity.fingerprint || '—']
  ]) {
    const row = document.createElement('div');
    row.className = 'tip-row';
    const label = document.createElement('b');
    label.textContent = key;
    const content = document.createElement('span');
    content.textContent = value;
    row.append(label, content);
    tip.append(row);
  }
  tip.hidden = false;
  const left = Math.max(6, Math.min(mark.offsetLeft, container.clientWidth - tip.offsetWidth - 6));
  const above = mark.offsetTop - tip.offsetHeight - 8;
  tip.style.left = left + 'px';
  tip.style.top = (above >= 4 ? above : mark.offsetTop + mark.offsetHeight + 8) + 'px';
}

function hideTokenTip() {
  const tip = document.querySelector('#demo-output .token-tip');
  if (tip) tip.hidden = true;
}

function wireTokenTips(container) {
  container.addEventListener('mouseover', event => {
    const mark = event.target.closest('mark[data-tip]');
    if (mark) showTokenTip(mark);
  });
  container.addEventListener('mouseleave', hideTokenTip);
  container.addEventListener('focusin', event => {
    const mark = event.target.closest('mark[data-tip]');
    if (mark) showTokenTip(mark);
  });
  container.addEventListener('focusout', hideTokenTip);
}

function setBusyButton(button, busy, busyLabel, idleLabel) {
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
  button.setAttribute('aria-busy', String(busy));
  if (idleLabel) button.textContent = busy ? busyLabel : idleLabel;
}

/* ── Démonstration ──────────────────────────────────────── */
function demoStatus(message, kind = '') {
  const el = $('demo-status');
  el.textContent = message;
  el.classList.toggle('ok', kind === 'ok');
  el.classList.toggle('error', kind === 'error');
}

function demoInvalidate() {
  demoSession = null;
  demoMasked = '';
  demoEntities = [];
  const out = $('demo-output');
  out.classList.add('empty');
  out.replaceChildren();

  const art = document.createElement('img');
  art.className = 'empty-art';
  art.src = '/assets/img/demo-empty.svg';
  art.width = 220; art.height = 150; art.alt = '';
  const strong = document.createElement('strong');
  strong.textContent = 'En attente de lancement';
  const p = document.createElement('p');
  p.textContent = 'Les données détectées apparaîtront ici sous forme de jetons réversibles.';
  const skeleton = document.createElement('div');
  skeleton.className = 'skeleton';
  skeleton.id = 'demo-skeleton';
  skeleton.hidden = true;
  skeleton.setAttribute('aria-hidden', 'true');
  skeleton.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));

  out.append(art, strong, p, skeleton);
  renderInputMarks($('demo-input').value, []);
  $('demo-entities').hidden = true;
  $('demo-entities').replaceChildren();
  $('demo-restore').hidden = true;
  $('demo-roundtrip').textContent = '—';
  $('demo-roundtrip').classList.remove('ok');
  demoStatus('');
}

function setDemoBusy(value) {
  demoBusy = value;
  setBusyButton($('demo-run'), value, 'Analyse en cours…', 'Lancer la démonstration →');
  $('demo-next').disabled = value;
  $('demo-reset').disabled = value;
  $('demo-input').readOnly = value;
  const out = $('demo-output');
  out.setAttribute('aria-busy', String(value));
  const skeleton = $('demo-skeleton');
  if (skeleton) skeleton.hidden = !value;
}

async function runDemo() {
  if (demoBusy) return;
  const text = $('demo-input').value.trim();
  if (!text) { demoStatus('Choisissez d’abord un exemple de texte.', 'error'); return; }

  setDemoBusy(true);
  demoStatus('Analyse locale en cours…');
  try {
    const masked = await api('mask', { text });
    demoMasked = masked.masked_text;
    demoSession = masked.session_id;
    demoEntities = masked.entities || [];
    renderMasked($('demo-output'), demoMasked);
    renderInputMarks($('demo-input').value, demoEntities);

    const chips = $('demo-entities');
    chips.replaceChildren();
    for (const entity of masked.entities) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      const code = document.createElement('code');
      code.textContent = entity.placeholder;
      const em = document.createElement('em');
      em.textContent = (labels[entity.type] || entity.type) + ' · ' + Math.round(entity.confidence * 100) + ' %';
      chip.append(code, em);
      chips.append(chip);
    }
    chips.hidden = masked.entities.length === 0;

    const restored = await api('unmask', { text: demoMasked, session_id: demoSession });
    $('demo-restored').textContent = restored.text;
    $('demo-restore').hidden = false;

    const identical = restored.text === text && restored.unresolved.length === 0;
    const badge = $('demo-roundtrip');
    badge.textContent = identical ? 'Round-trip identique ✓' : 'Valeurs inconnues conservées';
    badge.classList.toggle('ok', identical);

    demoStatus(
      masked.entities.length + ' donnée(s) protégée(s), restaurée(s) sans perte.',
      identical ? 'ok' : 'error'
    );
  } catch (error) {
    demoInvalidate();
    demoStatus(errorMessage(error), 'error');
  } finally {
    setDemoBusy(false);
  }
}

$('demo-run').addEventListener('click', runDemo);
$('demo-input').addEventListener('input', () => {
  if (demoSession) demoInvalidate();
  demoStatus('');
});
$('demo-input').addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); runDemo(); }
});
$('demo-next').addEventListener('click', () => {
  demoIndex = (demoIndex + 1) % DEMO_EXAMPLES.length;
  $('demo-input').value = DEMO_EXAMPLES[demoIndex];
  demoInvalidate();
  demoStatus('Exemple ' + (demoIndex + 1) + ' sur ' + DEMO_EXAMPLES.length + '.');
  $('demo-input').focus();
});
$('demo-reset').addEventListener('click', () => {
  demoIndex = 0;
  $('demo-input').value = DEMO_EXAMPLES[0];
  demoInvalidate();
  $('demo-input').focus();
});

/* ── Extrait de code ────────────────────────────────────── */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

$('copy-snippet').addEventListener('click', async () => {
  const button = $('copy-snippet');
  const done = label => {
    button.textContent = label;
    setTimeout(() => { button.textContent = 'Copier'; }, 1800);
  };
  done(await copyText($('snippet').innerText) ? 'Copié ✓' : 'Copie indisponible');
});

/* ── État du service ────────────────────────────────────── */
async function health() {
  try {
    const result = await api('health');
    $('provider').textContent = result.upstream_configured
      ? 'Configuré sur le serveur (connectivité non vérifiée).'
      : 'Aucun fournisseur configuré · écho de développement.';
    $('service-state').textContent = 'Accessible · mode ' + (result.mode === 'fail-closed' ? 'strict' : 'permissif');
  } catch {
    $('provider').textContent = 'État du fournisseur indisponible.';
    $('service-state').textContent = 'Service injoignable. Démarrez Veilforge puis rechargez la page.';
  }
}

/* ── Bandeau de modèles en défilement ───────────────────── */
function initMarquee() {
  const marquee = document.querySelector('[data-marquee]');
  if (!marquee) return;
  const track = marquee.querySelector('.marquee-track');
  const group = track && track.firstElementChild;
  if (!group) return;
  const clone = group.cloneNode(true);
  clone.setAttribute('aria-hidden', 'true');
  track.append(clone);
  marquee.classList.add('is-animated');
}

/* ── Navigation par ancres ──────────────────────────────── */
const anchors = ['exemple', 'fonctionnement', 'capacites', 'integration'];

function route() {
  const raw = location.hash.slice(1);
  const target = anchors.includes(raw) ? raw : null;

  document.querySelectorAll('.topnav-links a').forEach(link => {
    link.classList.toggle('is-active', link.getAttribute('href') === '#' + raw);
  });

  if (target) {
    requestAnimationFrame(() => {
      const el = document.getElementById(target);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  } else if (raw === 'accueil') {
    window.scrollTo({ top: 0 });
  }
}
window.addEventListener('hashchange', route);

/* ── Exemples d'intégration, un onglet par fournisseur ─── */
const SNIPPETS = {
  openai: {
    label: 'Python · client OpenAI',
    code: 'from openai import OpenAI\n\n' +
      'client = OpenAI(\n' +
      '    base_url="http://localhost:8787/v1",\n' +
      '    api_key="local-dev-key",\n' +
      ')\n\n' +
      'client.chat.completions.create(\n' +
      '    model="gpt-4o-mini",\n' +
      '    messages=[{"role": "user",\n' +
      '               "content": "Écris un mail à ana@example.com"}],\n' +
      ')'
  },
  gemini: {
    label: 'Python · modèle Gemini',
    code: 'from openai import OpenAI\n\n' +
      'client = OpenAI(\n' +
      '    base_url="http://localhost:8787/v1",\n' +
      '    api_key="local-dev-key",\n' +
      ')\n\n' +
      'client.chat.completions.create(\n' +
      '    model="gemini-2.0-flash",\n' +
      '    messages=[{"role": "user",\n' +
      '               "content": "Écris un mail à ana@example.com"}],\n' +
      ')'
  },
  mistral: {
    label: 'Python · modèle Mistral',
    code: 'from openai import OpenAI\n\n' +
      'client = OpenAI(\n' +
      '    base_url="http://localhost:8787/v1",\n' +
      '    api_key="local-dev-key",\n' +
      ')\n\n' +
      'client.chat.completions.create(\n' +
      '    model="mistral-large-latest",\n' +
      '    messages=[{"role": "user",\n' +
      '               "content": "Écris un mail à ana@example.com"}],\n' +
      ')'
  },
  node: {
    label: 'Node.js · client OpenAI',
    code: 'import OpenAI from "openai";\n\n' +
      'const client = new OpenAI({\n' +
      '  baseURL: "http://localhost:8787/v1",\n' +
      '  apiKey: "local-dev-key",\n' +
      '});\n\n' +
      'const r = await client.chat.completions.create({\n' +
      '  model: "gpt-4o-mini",\n' +
      '  messages: [{ role: "user", content: "Écris un mail à ana@example.com" }],\n' +
      '});\n' +
      'console.log(r.choices[0].message.content);'
  },
  curl: {
    label: 'cURL · chat completions',
    code: `curl -s http://localhost:8787/v1/chat/completions \\
  -H "Authorization: Bearer local-dev-key" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini",
       "messages":[{"role":"user","content":"Écris un mail à ana@example.com"}]}'`
  }
};

function showSnippet(key) {
  const snippet = SNIPPETS[key];
  if (!snippet) return;
  $('snippet').textContent = snippet.code;
  $('snippet-label').textContent = snippet.label;
  document.querySelectorAll('.snippet-tab').forEach(tab => {
    const active = tab.dataset.snippet === key;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
}

document.querySelectorAll('.snippet-tab').forEach(tab => {
  tab.addEventListener('click', () => showSnippet(tab.dataset.snippet));
});

/* ── Démarrage ──────────────────────────────────────────── */
$('base-url').textContent = location.origin + '/v1';
$('demo-input').value = DEMO_EXAMPLES[0];
renderInputMarks($('demo-input').value, []);
$('demo-input').addEventListener('scroll', () => {
  const layer = $('demo-marks');
  if (layer) layer.scrollTop = $('demo-input').scrollTop;
});
wireTokenTips($('demo-output'));
initMarquee();
route();
health();
/* Premier exemple affiché dès l'ouverture de la page. */
setTimeout(() => { if (!demoSession && !demoBusy) runDemo(); }, 450);
