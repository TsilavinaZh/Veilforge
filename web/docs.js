/* Veilforge — page documentation : chargeur, copie, santé, sommaire actif */

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  const loader = $('loader');
  if (loader && !loader.classList.contains('is-done')) loader.classList.add('is-done');
});

/* ── Copier les blocs de code ─────────────────────────── */
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

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const block = document.getElementById('code-' + button.dataset.copy);
  if (!block) return;
  const previous = button.textContent;
  button.textContent = (await copyText(block.textContent)) ? 'Copié ✓' : 'Copie impossible';
  setTimeout(() => { button.textContent = previous; }, 1400);
});

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

initScrollSpy();
