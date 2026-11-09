/* Veilforge — page documentation : chargeur, copie, santé, sommaire actif */

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  const loader = $('loader');
  if (loader && !loader.classList.contains('is-done')) loader.classList.add('is-done');
});

/* ── Copier les blocs de code ─────────────────────────── */
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const block = document.getElementById('code-' + button.dataset.copy);
  if (!block) return;
  try {
    await navigator.clipboard.writeText(block.textContent);
    const previous = button.textContent;
    button.textContent = 'Copié ✓';
    setTimeout(() => { button.textContent = previous; }, 1400);
  } catch {
    button.textContent = 'Copie impossible';
    setTimeout(() => { button.textContent = 'Copier'; }, 1400);
  }
});

/* ── État du service (badge de la barre) ──────────────── */
async function health() {
  const badge = $('doc-health');
  if (!badge) return;
  try {
    const response = await fetch('/api/v1/health');
    if (!response.ok) throw new Error(String(response.status));
    const state = await response.json();
    badge.textContent = state.upstream_configured
      ? 'Service actif · amont configuré'
      : 'Service actif · ' + (state.mode || 'strict');
    badge.classList.add('ok');
  } catch {
    badge.textContent = 'Service hors ligne';
    badge.classList.add('error');
  }
}

/* ── Sommaire : section en cours ──────────────────────── */
function initScrollSpy() {
  const links = Array.from(document.querySelectorAll('.toc a[href^="#"]'));
  const sections = links
    .map((link) => document.getElementById(link.getAttribute('href').slice(1)))
    .filter(Boolean);
  if (!sections.length || !('IntersectionObserver' in window)) return;

  const visible = new Map();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => visible.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0));
    let best = null;
    let bestRatio = 0;
    visible.forEach((ratio, id) => { if (ratio > bestRatio) { bestRatio = ratio; best = id; } });
    if (!best) return;
    links.forEach((link) => {
      link.classList.toggle('is-active', link.getAttribute('href') === '#' + best);
    });
  }, { rootMargin: '-88px 0px -55% 0px', threshold: [0, .2, .5, 1] });

  sections.forEach((section) => observer.observe(section));
}

/* ── Ancres : défilement doux déjà géré par styles.css ── */
document.addEventListener('click', (event) => {
  const link = event.target.closest('.toc a[href^="#"]');
  if (!link) return;
  const target = document.getElementById(link.getAttribute('href').slice(1));
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  history.replaceState(null, '', link.getAttribute('href'));
});

health();
initScrollSpy();
