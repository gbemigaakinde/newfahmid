/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Pupil Portal — Available CBT Tests
 *
 * Extracted from the inline <script> that used to live at the
 * bottom of pupil.html. Taking a test still happens on cbt.html
 * (js/cbt.js) — that's a separate, not-yet-migrated page.
 */

import { watchAuthState } from "../../js/firebase-auth.js";
import { api } from "../../js/api-client.js";

const CBT_TESTS_PAGE_SIZE = 3;
let cbtAllTests = [];
let cbtVisibleCount = CBT_TESTS_PAGE_SIZE;

async function loadPupilTests() {
  const container = document.getElementById("pp-tests-content");
  if (!container) return;

  try {
    const { tests, reason } = await api.get("/api/pupil/cbt/tests");

    if (reason) {
      container.innerHTML = `<p style="text-align:center;color:#94a3b8;padding:24px;font-size:13px;">${reason}</p>`;
      return;
    }

    if (tests.length === 0) {
      renderEmptyState(container);
      return;
    }

    cbtAllTests = tests;
    cbtVisibleCount = CBT_TESTS_PAGE_SIZE;
    renderPupilTestsPage();
  } catch (err) {
    console.error("Error loading pupil tests:", err);
    container.innerHTML = `<p style="text-align:center;color:#dc2626;padding:24px;font-size:13px;">Failed to load tests. Please refresh the page.</p>`;
  }
}

function renderEmptyState(container) {
  container.innerHTML = `
    <div class="cbt-empty">
      <i data-lucide="monitor" style="width:40px;height:40px;margin-bottom:10px;opacity:0.3;display:block;margin-left:auto;margin-right:auto;"></i>
      <div class="cbt-empty-title">No tests yet</div>
      <div class="cbt-empty-desc">Your teacher has not published any tests yet. Check back soon.</div>
    </div>`;
  if (typeof lucide !== "undefined") lucide.createIcons();
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("en-GB") : null;
}

/**
 * Renders however many tests are currently "visible"
 * (cbtVisibleCount), plus a Load More button if there are more.
 */
function renderPupilTestsPage() {
  const container = document.getElementById("pp-tests-content");
  if (!container) return;

  const visibleTests = cbtAllTests.slice(0, cbtVisibleCount);
  const remaining = cbtAllTests.length - visibleTests.length;

  let cardsHTML = '<div style="display:flex;flex-direction:column;gap:12px;">';

  for (const t of visibleTests) {
    const scoreDisplay = t.result
      ? `<div class="cbt-test-card__score">
          <i data-lucide="check-circle"></i>
          Your score: ${t.result.score}/${t.result.total} · ${t.result.percentage}% · Grade ${t.result.grade}
        </div>`
      : "";

    const statusPill = t.done
      ? '<span class="cbt-status-pill cbt-status-pill--done">✓ Completed</span>'
      : t.windowStatus === "upcoming"
        ? '<span class="cbt-status-pill cbt-status-pill--upcoming">⏳ Scheduled</span>'
        : t.windowStatus === "expired"
          ? '<span class="cbt-status-pill cbt-status-pill--expired">Expired</span>'
          : '<span class="cbt-status-pill cbt-status-pill--open">● Open</span>';

    let actionHTML = "";
    if (t.canTake) {
      actionHTML = `
        <div class="cbt-test-card__action">
          <a href="cbt.html?testId=${t.id}"
             class="pp-action-btn pp-action-btn--solid"
             style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;padding:10px 20px;">
            <i data-lucide="play" style="width:14px;height:14px;"></i>
            Start Test
          </a>
        </div>`;
    } else if (!t.done) {
      actionHTML = `
        <div class="cbt-test-card__action">
          <span class="pp-action-btn" style="opacity:0.6;cursor:not-allowed;display:inline-flex;align-items:center;justify-content:center;padding:10px 20px;background:#f1f5f9;color:#64748b;border:1.5px solid #e2e8f0;">
            ${t.windowStatus === "upcoming" ? "⏳ Not yet open" : "✗ Expired"}
          </span>
        </div>`;
    }

    const scheduleInfo = formatDate(t.scheduledDate) ? `<div>Opens: ${formatDate(t.scheduledDate)}</div>` : "";
    const expiryInfo = formatDate(t.expiryDate) ? `<div>Closes: ${formatDate(t.expiryDate)}</div>` : "";
    const datesBlock =
      !t.done && (scheduleInfo || expiryInfo)
        ? `<div class="cbt-test-card__dates">${scheduleInfo}${expiryInfo}</div>`
        : "";

    cardsHTML += `
      <div class="cbt-test-card cbt-test-card--${t.done ? "completed" : t.windowStatus}">
        <div class="cbt-test-card__body">
          <div class="cbt-test-card__title-row">
            <div class="cbt-test-card__title">${t.title}</div>
            ${statusPill}
          </div>
          <div class="cbt-test-card__meta">
            <span><i data-lucide="book-open"></i>${t.subject}</span>
            <span><i data-lucide="tag"></i>${t.type}</span>
            <span><i data-lucide="clock"></i>${t.timerMinutes ? t.timerMinutes + " min" : "No timer"}</span>
            <span><i data-lucide="calendar"></i>${t.term}</span>
          </div>
          ${scoreDisplay}
          ${datesBlock}
        </div>
        ${actionHTML}
      </div>`;
  }

  cardsHTML += "</div>";

  if (remaining > 0) {
    cardsHTML += `
      <button type="button" class="cbt-load-more-btn" id="pp-load-more-tests">
        <i data-lucide="chevron-down"></i>
        Load ${Math.min(remaining, CBT_TESTS_PAGE_SIZE)} more test${Math.min(remaining, CBT_TESTS_PAGE_SIZE) > 1 ? "s" : ""} (${remaining} remaining)
      </button>`;
  }

  container.innerHTML = cardsHTML;
  if (typeof lucide !== "undefined") lucide.createIcons();

  const loadMoreBtn = document.getElementById("pp-load-more-tests");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => loadMorePupilTests(loadMoreBtn));
  }
}

function loadMorePupilTests(btn) {
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="cbt-btn-loading-text">Loading more tests…</span>`;
  }
  cbtVisibleCount += CBT_TESTS_PAGE_SIZE;
  renderPupilTestsPage();
}

// Wait for Firebase Auth to be ready, then load tests. A small delay
// lets pupil.js finish its own setup first (same as the original).
const unsubscribe = watchAuthState((user) => {
  if (user) {
    unsubscribe();
    setTimeout(loadPupilTests, 800);
  }
});
