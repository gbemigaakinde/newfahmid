/**
 * FAHMID NURSERY & PRIMARY SCHOOL
 * Pupil Portal JavaScript
 * @version 5.0.0 — rewritten to call the Worker API instead of
 * reading Firestore directly from the browser.
 */

import { requireRole, handleApiError } from "../../js/session.js";
import { api } from "../../js/api-client.js";

let currentPupilId = null;
let currentProfileSnapshot = null; // JSON string, used to skip no-op re-renders
let profilePollIntervalId = null;

const PROFILE_POLL_MS = 45 * 1000; // 30-60s window; see architecture note below

requireRole("pupil")
  .then(async (session) => {
    currentPupilId = session.uid;
    await loadPupilProfile();
    startProfilePolling();
  })
  .catch(() => {
    // requireRole already redirects to /login; nothing else to do.
  });

window.addEventListener("beforeunload", () => {
  if (profilePollIntervalId) {
    clearInterval(profilePollIntervalId);
    profilePollIntervalId = null;
  }
});

/**
 * The old portal used Firestore onSnapshot listeners on the pupil
 * doc and class doc, so edits made in the office appeared instantly.
 * A REST Worker API has no equivalent push mechanism, so instead we
 * poll /api/pupil/profile every 45 seconds and only re-render when
 * something actually changed.
 */
function startProfilePolling() {
  if (profilePollIntervalId) clearInterval(profilePollIntervalId);
  profilePollIntervalId = setInterval(() => {
    loadPupilProfile({ silent: true }).catch(() => {
      // A silent poll failure shouldn't interrupt the pupil.
    });
  }, PROFILE_POLL_MS);
}

async function loadPupilProfile({ silent = false } = {}) {
  try {
    const { profile } = await api.get("/api/pupil/profile");

    const snapshot = JSON.stringify(profile);
    if (snapshot === currentProfileSnapshot) {
      return; // nothing changed since the last poll
    }
    currentProfileSnapshot = snapshot;

    renderProfile(profile);

    if (!silent) {
      await loadResults();
      await loadFeeBalance();
    }
  } catch (error) {
    if (!silent) {
      handleApiError(error, "Could not load your profile");
    }
  }
}

function renderProfile(profile) {
  const nameDisplay = document.getElementById("pupil-name-display");
  const dobDisplay = document.getElementById("pupil-dob-display");
  const admissionDisplay = document.getElementById("pupil-admission-display");
  const genderDisplay = document.getElementById("pupil-gender-display");
  const contactDisplay = document.getElementById("pupil-contact-display");
  const addressDisplay = document.getElementById("pupil-address-display");
  const classDisplay = document.getElementById("pupil-class-display");
  const teacherDisplay = document.getElementById("pupil-teacher-display");
  const subjectsDisplay = document.getElementById("pupil-subjects-display");

  if (nameDisplay) nameDisplay.textContent = profile.name;
  if (dobDisplay) dobDisplay.textContent = profile.dob;
  if (admissionDisplay) admissionDisplay.textContent = profile.admissionNo || "-";
  if (genderDisplay) genderDisplay.textContent = profile.gender;
  if (contactDisplay) contactDisplay.textContent = profile.contact;
  if (addressDisplay) addressDisplay.textContent = profile.address;

  if (profile.isAlumni) {
    if (classDisplay) {
      classDisplay.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span>${profile.class}</span>
          <span style="background: #4CAF50; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">GRADUATED</span>
        </div>
      `;
    }
    if (teacherDisplay) {
      teacherDisplay.textContent = "-";
      teacherDisplay.style.color = "#94a3b8";
    }
    if (subjectsDisplay) {
      subjectsDisplay.textContent = "-";
      subjectsDisplay.style.color = "#94a3b8";
    }
  } else {
    if (classDisplay) classDisplay.textContent = profile.class;
    if (teacherDisplay) {
      teacherDisplay.textContent = profile.teacher;
      teacherDisplay.style.color = "";
    }
    if (subjectsDisplay) {
      const subjectList =
        profile.subjects && profile.subjects.length > 0 ? profile.subjects.join(", ") : "-";
      subjectsDisplay.textContent = subjectList;
      subjectsDisplay.style.color = "";
    }
  }
}

/* ────────────────────────────── RESULTS ────────────────────────────── */

async function loadResults() {
  if (!currentPupilId) return;

  const container = document.getElementById("results-container");
  if (!container) return;

  container.innerHTML = `
    <div class="skeleton-container">
      <div class="skeleton" style="height:40px;width:60%;margin:var(--space-xl) auto;"></div>
      <div class="skeleton" style="height:30px;margin:var(--space-lg) 0 var(--space-sm);"></div>
      <div class="skeleton" style="height:30px;margin-bottom:var(--space-sm);"></div>
    </div>
  `;

  try {
    await populateSessionSelector();
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const sessionSelect = document.getElementById("pupil-session-select");
    if (sessionSelect) {
      const newSessionSelect = sessionSelect.cloneNode(true);
      sessionSelect.parentNode.replaceChild(newSessionSelect, sessionSelect);

      newSessionSelect.addEventListener("change", async function () {
        const selectedValue = this.value;

        container.innerHTML = `
          <div style="text-align:center; padding:var(--space-2xl); color:var(--color-gray-600);">
            <div class="spinner" style="margin: 0 auto var(--space-md); width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #00B2FF; border-radius: 50%; animation: spin 1s linear infinite;"></div>
            <p>Loading results for ${selectedValue === "current" ? "current session" : selectedValue}...</p>
          </div>
        `;

        await new Promise((resolve) => setTimeout(resolve, 300));
        await loadSessionResults();
      });
    }

    await loadSessionResults();
  } catch (error) {
    container.innerHTML = `<p style="text-align:center;color:var(--color-danger); padding:var(--space-2xl);">
      ⚠️ Unable to load results. Try again later.
    </p>`;
  }
}

async function populateSessionSelector() {
  const selector = document.getElementById("pupil-session-select");
  if (!selector) return;

  try {
    const { isAlumni, currentSession, sessions } = await api.get("/api/pupil/results/sessions");

    selector.innerHTML = "";

    if (sessions.length === 0 && isAlumni) {
      selector.innerHTML = '<option value="">No results available</option>';
      return;
    }

    sessions.forEach((session) => {
      const opt = document.createElement("option");
      opt.value = session;
      opt.textContent =
        session === "current" ? `Current Session (${currentSession})` : `${session} Session`;
      selector.appendChild(opt);
    });
  } catch (error) {
    selector.innerHTML = '<option value="current">Current Session (Error loading)</option>';
  }
}

async function loadSessionResults() {
  if (!currentPupilId) return;

  const container = document.getElementById("results-container");
  if (!container) return;

  const sessionSelect = document.getElementById("pupil-session-select");
  const sessionInfo = document.getElementById("session-info");
  const selectedSessionNameEl = document.getElementById("selected-session-name");

  container.innerHTML = `
    <div style="text-align:center; padding:var(--space-2xl); color:var(--color-gray-600);">
      <div class="spinner" style="margin: 0 auto var(--space-md); width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #00B2FF; border-radius: 50%; animation: spin 1s linear infinite;"></div>
      <p>Loading results...</p>
    </div>
  `;

  try {
    const selectedSession = sessionSelect?.value || "current";

    const { displaySessionName, results: pupilResults } = await api.get(
      `/api/pupil/results?session=${encodeURIComponent(selectedSession)}`
    );

    if (selectedSessionNameEl) selectedSessionNameEl.textContent = displaySessionName;
    if (sessionInfo) sessionInfo.style.display = "block";

    container.innerHTML = "";

    if (pupilResults.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px 24px;">
          <i data-lucide="inbox" style="width:36px;height:36px;margin:0 auto 12px;opacity:0.35;display:block;color:#64748b;"></i>
          <p style="margin:0 0 4px; font-size:14px; font-weight:600; color:#475569;">
            No approved results found for this session
          </p>
          <p style="margin:0; font-size:12.5px; color:#94a3b8;">
            ${selectedSession === "current"
              ? "Your teacher will upload your scores soon."
              : "No approved results available for this historical session."}
          </p>
        </div>`;
      if (typeof lucide !== "undefined") lucide.createIcons();
      return;
    }

    const terms = {};
    pupilResults.forEach((r) => {
      if (!terms[r.term]) terms[r.term] = [];
      terms[r.term].push(r);
    });

    ["First Term", "Second Term", "Third Term"].forEach((termName) => {
      if (!terms[termName]) return;

      const termSection = document.createElement("div");
      termSection.className = "results-term-section";
      termSection.style.marginBottom = "var(--space-2xl)";

      const heading = document.createElement("h3");
      heading.textContent = termName;
      heading.style.marginBottom = "var(--space-md)";
      heading.style.color = "#0f172a";
      termSection.appendChild(heading);

      const table = document.createElement("table");
      table.className = "results-table";
      const caption = document.createElement("caption");
      caption.className = "visually-hidden";
      caption.textContent = `${termName} results`;
      table.appendChild(caption);
      table.innerHTML += `
        <thead>
          <tr>
            <th scope="col">SUBJECT</th>
            <th scope="col">CA (40)</th>
            <th scope="col">EXAM (60)</th>
            <th scope="col">TOTAL (100)</th>
            <th scope="col">GRADE</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;
      const tbody = table.querySelector("tbody");

      let termTotal = 0;
      let subjectCount = 0;

      terms[termName]
        .sort((a, b) => a.subject.localeCompare(b.subject))
        .forEach((r) => {
          const grade = getGrade(r.total);
          tbody.innerHTML += `
            <tr>
              <td><strong>${r.subject}</strong></td>
              <td style="text-align:center;">${r.caScore}</td>
              <td style="text-align:center;">${r.examScore}</td>
              <td style="text-align:center;font-weight:bold;">${r.total}</td>
              <td style="text-align:center;" class="grade-${grade}">${grade}</td>
            </tr>`;
          termTotal += r.total;
          subjectCount++;
        });

      if (subjectCount > 0) {
        const average = (termTotal / subjectCount).toFixed(1);
        const avgGrade = getGrade(parseFloat(average));

        tbody.innerHTML += `
          <tr class="summary-row">
            <td colspan="3"><strong>TOTAL SCORE</strong></td>
            <td colspan="2"><strong>${termTotal} / ${subjectCount * 100}</strong></td>
          </tr>
          <tr class="summary-row">
            <td colspan="3"><strong>AVERAGE</strong></td>
            <td colspan="2"><strong>${average}% (${avgGrade})</strong></td>
          </tr>`;
      }

      termSection.appendChild(table);
      container.appendChild(termSection);
    });
  } catch (error) {
    container.innerHTML = `
      <p style="text-align:center; color:var(--color-danger); padding:var(--space-2xl);">
        ⚠️ Unable to load results. Please try again.
      </p>`;
  }
}

function getGrade(score) {
  if (score >= 75) return "A1";
  if (score >= 70) return "B2";
  if (score >= 65) return "B3";
  if (score >= 60) return "C4";
  if (score >= 55) return "C5";
  if (score >= 50) return "C6";
  if (score >= 45) return "D7";
  if (score >= 40) return "D8";
  return "F9";
}

/* ──────────────────────────── FEE BALANCE ──────────────────────────── */

async function loadFeeBalance() {
  const section = document.getElementById("fee-balance-section");
  if (!section || !currentPupilId) return;

  const summaryEl = document.getElementById("fee-balance-summary");
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="skeleton" style="height:28px;width:50%;margin-bottom:12px;"></div>
      <div class="skeleton" style="height:20px;width:80%;"></div>
    `;
  }

  try {
    const { fees } = await api.get("/api/pupil/fees");
    renderFeeBalanceSummary(fees);
    await loadAllPaymentHistory(currentPupilId);
  } catch (error) {
    if (summaryEl) {
      summaryEl.innerHTML = `<p style="color:var(--color-danger);">⚠️ Unable to load fee balance.</p>`;
    }
    handleApiError(error, "Could not load fee balance");
  }
}

function renderFeeBalanceSummary(fees) {
  const summaryEl = document.getElementById("fee-balance-summary");
  if (!summaryEl) return;

  if (fees.reason) {
    summaryEl.innerHTML = `<p style="color:var(--color-gray-600);">${fees.reason}</p>`;
    return;
  }

  const naira = (n) => `₦${Number(n || 0).toLocaleString()}`;

  const STATUS_LABEL = {
    paid: { text: "Fully Paid", color: "#16a34a" },
    partial: { text: "Partially Paid", color: "#d97706" },
    owing: { text: "Outstanding", color: "#dc2626" },
    owing_with_arrears: { text: "Outstanding (incl. arrears)", color: "#dc2626" },
    overpaid: { text: "Credit Balance", color: "#2563eb" },
  };
  const statusInfo = STATUS_LABEL[fees.status] || { text: fees.status, color: "#64748b" };

  summaryEl.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px;">
      <span style="font-weight:600;">${fees.session} — ${fees.term}</span>
      <span style="font-weight:700; color:${statusInfo.color};">${statusInfo.text}</span>
    </div>
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:12px; margin-top:12px;">
      <div><div style="font-size:12px; color:#64748b;">Fee for this term</div><div style="font-weight:700;">${naira(fees.amountDue)}</div></div>
      ${fees.arrears > 0 ? `<div><div style="font-size:12px; color:#64748b;">Arrears carried forward</div><div style="font-weight:700; color:#dc2626;">${naira(fees.arrears)}</div></div>` : ""}
      <div><div style="font-size:12px; color:#64748b;">Total paid</div><div style="font-weight:700; color:#16a34a;">${naira(fees.totalPaid)}</div></div>
      <div><div style="font-size:12px; color:#64748b;">${fees.credit > 0 ? "Credit balance" : "Balance owed"}</div><div style="font-weight:700; color:${fees.credit > 0 ? "#2563eb" : "#dc2626"};">${naira(fees.credit > 0 ? fees.credit : fees.balance)}</div></div>
    </div>
  `;
}

async function loadAllPaymentHistory(pupilId) {
  const listEl = document.getElementById("payment-history-list");
  if (!listEl) return;

  listEl.innerHTML = `<div class="skeleton" style="height:60px;margin-bottom:8px;"></div>`;

  try {
    const { transactions } = await api.get("/api/pupil/payments");

    if (!transactions.length) {
      listEl.innerHTML = `<p style="text-align:center; color:#94a3b8; padding:24px;">No payment records yet.</p>`;
      return;
    }

    const bySession = {};
    transactions.forEach((txn) => {
      const key = txn.session || "Unknown Session";
      if (!bySession[key]) bySession[key] = [];
      bySession[key].push(txn);
    });

    listEl.innerHTML = "";

    Object.entries(bySession).forEach(([session, txns]) => {
      const group = document.createElement("div");
      group.style.marginBottom = "var(--space-lg)";

      const heading = document.createElement("h4");
      heading.textContent = session;
      heading.style.margin = "0 0 8px";
      group.appendChild(heading);

      txns.forEach((txn) => {
        const card = buildTransactionCard(txn);
        group.appendChild(card);
      });

      listEl.appendChild(group);
    });
  } catch (error) {
    listEl.innerHTML = `<p style="text-align:center; color:var(--color-danger); padding:24px;">⚠️ Unable to load payment history.</p>`;
  }
}

function buildTransactionCard(txn) {
  const card = document.createElement("div");
  card.style.cssText =
    "border:1px solid #e2e8f0; border-radius:10px; padding:12px 16px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;";

  // paymentDate arrives as an ISO string from the Worker API, not a
  // Firestore Timestamp — so it's new Date(...) here, not .toDate().
  const dateLabel = txn.paymentDate
    ? new Date(txn.paymentDate).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "-";

  card.innerHTML = `
    <div>
      <div style="font-weight:600;">${txn.term || ""}</div>
      <div style="font-size:12px; color:#64748b;">${dateLabel}${txn.method ? " · " + txn.method : ""}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-weight:700; color:#16a34a;">₦${Number(txn.amount || 0).toLocaleString()}</div>
      ${
        txn.receiptNo
          ? `<button type="button" class="view-receipt-btn" data-receipt="${txn.receiptNo}" style="font-size:12px; color:#2563eb; background:none; border:none; cursor:pointer; padding:0;">View receipt</button>`
          : ""
      }
    </div>
  `;

  const receiptBtn = card.querySelector(".view-receipt-btn");
  if (receiptBtn) {
    receiptBtn.addEventListener("click", () => viewReceipt(txn.receiptNo));
  }

  return card;
}

function viewReceipt(receiptNo) {
  const receiptWindow = window.open(`receipt.html?receipt=${receiptNo}`, "_blank", "width=800,height=600");
  if (!receiptWindow) {
    window.showToast?.("Please allow popups to view receipts", "warning");
  }
}

function scrollToFees() {
  const feeSection = document.getElementById("fee-balance-section");
  if (feeSection) {
    feeSection.style.display = "block";
    feeSection.scrollIntoView({ behavior: "smooth", block: "start" });
    window.showToast?.("📊 Viewing fee balance", "info", 2000);
  }
}

// These remain on window because pupil.html calls them from inline
// onclick="" attributes — same pattern as before.
window.scrollToFees = scrollToFees;
window.loadSessionResults = loadSessionResults;
