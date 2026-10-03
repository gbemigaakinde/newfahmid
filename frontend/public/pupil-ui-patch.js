/**
 * PUPIL PORTAL — UI PATCH (pupil-ui-patch.js)
 */

(function() {
  'use strict';
  window.addEventListener('load', function() {
    const _originalRenderProfile = window.renderProfile || 
      (typeof renderProfile !== 'undefined' ? renderProfile : null);
    if (typeof renderProfile === 'function') {
      window.__renderProfileOriginal = renderProfile;
    }
    const nameEl = document.getElementById('pupil-name-display');
    if (nameEl) {
      const obs = new MutationObserver(() => {
        const name = nameEl.textContent?.trim();
        const greetingEl = document.getElementById('pupil-welcome');
        if (name && name !== 'Loading…' && name !== '-' && greetingEl) {
          const firstName = name.split(/\s+/)[0];
          greetingEl.innerHTML = `Hello, <strong>${firstName}</strong>!`;
        }
      });
      obs.observe(nameEl, { childList: true, characterData: true, subtree: true });
    }
    const resultsContainer = document.getElementById('results-container');
    if (resultsContainer) {
      const resultsObs = new MutationObserver(() => {
        const p = resultsContainer.querySelector('p[style*="text-align:center"]');
        if (p && p.parentElement === resultsContainer) {
          const text = p.textContent || '';
          resultsContainer.innerHTML = `
            <div class="pp-empty">
              <svg class="pp-empty__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <p class="pp-empty__title">No Results Available</p>
              <p class="pp-empty__text">${text.includes('soon') 
                ? 'Your teacher will upload your scores soon.'
                : 'No approved results found for this session.'}</p>
            </div>`;
        }
      });
      resultsObs.observe(resultsContainer, { childList: true });
    }
    const ppFees = document.getElementById('pp-fees');
    if (ppFees) {
      const feeObs = new MutationObserver(() => {
        if (ppFees.style.display !== 'none') {
          if (typeof lucide !== 'undefined') {
            lucide.createIcons();
          }
        }
      });
      feeObs.observe(ppFees, { attributes: true, attributeFilter: ['style'] });
    }
  });
})();
