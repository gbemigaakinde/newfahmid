/**
 * FAHMID NURSERY & PRIMARY SCHOOL
 * Teacher Portal JavaScript - DEBUGGED & FIXED
 * 
 * @version 8.1.0 - RACE CONDITIONS FIXED
 * @date 2026-01-08
 *
 * FIXES:
 * - Race condition in data loading resolved
 * - Initialization order corrected
 * - Defensive checks added for all data access
 * - Proper loading state management
 */
'use strict';

const db = window.db;
const auth = window.auth;

let currentUser = null;
let teacherName = null;
let assignedClasses = [];
let allPupils = [];
let allSubjects = [];

// FIXED: Add initialization state flags
let dataLoaded = false;
let isLoadingData = false;

/* ======================================== 
   INITIALIZATION WITH PROPER ORDER
======================================== */

/**
 * FIXED: Teacher Portal Initialization with Guaranteed Data Load
 * Replace the initialization block at the top of teacher.js (lines 15-32)
 */

// API_BASE_URL matches js/api-client.js — update both together when
// you deploy the Worker.
const TEACHER_API_BASE_URL = 'http://localhost:8787';

/**
 * A minimal authenticated GET helper. teacher.js stays a classic
 * script (not an ES module) because the 3,000+ lines below this
 * point still depend on module-level `let` variables like
 * assignedClasses/allPupils/allSubjects by bare name, not via
 * window — splitting it into an ES module would break every one of
 * those references. Only the data-loading functions below have been
 * changed to call the Worker API instead of Firestore directly.
 */
async function teacherApiGet(path) {
  const token = await window.auth.currentUser.getIdToken();
  const response = await fetch(`${TEACHER_API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return teacherApiHandleResponse(response);
}

async function teacherApiPost(path, body) {
  const token = await window.auth.currentUser.getIdToken();
  const response = await fetch(`${TEACHER_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return teacherApiHandleResponse(response);
}

async function teacherApiHandleResponse(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'Request failed');
    error.code = data?.error?.code || 'REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  return data;
}

window.checkRole('teacher')
  .then(async user => {
    currentUser = user;
    window.currentUser = user;
    const info = document.getElementById('teacher-info');

    try {
      console.log('Starting teacher data load...');
      isLoadingData = true;
      await loadAssignedClasses();
      console.log('✓ Classes loaded:', assignedClasses.length);
      await loadSubjects();
      console.log('✓ Subjects loaded:', allSubjects.length);
      dataLoaded = true;
      isLoadingData = false;
      console.log('✓ All teacher data loaded successfully');

      if (info) {
        info.innerHTML = `Logged in as:<br><strong>${teacherName || user.email}</strong>`;
      }

      initTeacherPortal();
    } catch (error) {
      console.error('❌ Failed to load teacher data:', error);
      isLoadingData = false;
      dataLoaded = false;

      if (info) {
        info.innerHTML = `Logged in as:<br><strong>${user.email}</strong>`;
      }

      window.showToast?.(
        'Failed to load your teaching data. Please refresh the page.',
        'danger',
        10000
      );
      showSection('dashboard');
    }
  })
  .catch(err => {
    console.error('Authentication check failed:', err);
  });
  
document.getElementById('teacher-logout')?.addEventListener('click', e => {
  e.preventDefault();
  window.logout();
});

/* ======================================== 
   DATA LOADING WITH STATE MANAGEMENT
======================================== */

async function loadAssignedClasses() {
  if (!currentUser) {
    console.warn('loadAssignedClasses called before user is set');
    return;
  }

  // Previously: a direct Firestore query for classes where
  // teacherId == currentUser.uid, then a batched 'in' query against
  // pupils, all run from the browser. Both now happen inside the
  // Worker's getTeacherRoster() — see backend/business/school/
  // teacher-roster.js — and are fetched here as a single call.
  try {
    const roster = await teacherApiGet('/api/teacher/roster');

    teacherName = roster.teacherName || currentUser.email;
    assignedClasses = roster.classes;
    allPupils = roster.pupils;
    allSubjects = roster.subjects;

    if (assignedClasses.length === 0) {
      window.showToast?.('No classes assigned yet. Contact admin.', 'warning', 8000);
    }

    // EXPOSE TO WINDOW so attendance-teacher-ui.js and other modules can access
    window.assignedClasses = assignedClasses;
    window.allPupils = allPupils;
    window.allSubjects = allSubjects;

    console.log(`✓ Loaded ${assignedClasses.length} class(es), ${allPupils.length} pupil(s), ${allSubjects.length} subject(s)`);

  } catch (err) {
    console.error('Error loading assigned classes:', err);
    window.handleError?.(err, 'Failed to load your classes');
    assignedClasses = [];
    allPupils = [];
    allSubjects = [];
    window.assignedClasses = [];
    window.allPupils = [];
    window.allSubjects = [];
    throw err;
  }
}

async function loadSubjects() {
  // Subjects are loaded from assigned classes in loadAssignedClasses()
  console.log('✓ Subjects loaded from assigned classes:', allSubjects.length);
}

/* ======================================== 
   DEFENSIVE DATA ACCESS HELPERS
======================================== */

function ensureDataLoaded(functionName) {
  if (isLoadingData) {
    console.log(`${functionName} called while data is loading - please wait`);
    window.showToast?.('Loading data, please wait...', 'info', 2000);
    return false;
  }
  
  if (!dataLoaded) {
    console.warn(`${functionName} called before data is loaded`);
    window.showToast?.('Data not loaded yet. Please refresh the page.', 'warning');
    return false;
  }
  
  return true;
}

function getValidPupils() {
  if (!ensureDataLoaded('getValidPupils')) return [];
  return Array.isArray(allPupils) ? allPupils : [];
}

function getValidClasses() {
  if (!ensureDataLoaded('getValidClasses')) return [];
  return Array.isArray(assignedClasses) ? assignedClasses : [];
}

function getValidSubjects() {
  if (!ensureDataLoaded('getValidSubjects')) return [];
  return Array.isArray(allSubjects) ? allSubjects : [];
}

/**
 * ✅ NEW: Religion-based subject applicability check.
 * Returns false only when the subject is the Religious Studies variant
 * that conflicts with the pupil's religion — true for everything else,
 * including when religion is unset (fail-open, so nothing breaks for
 * pupils whose religion hasn't been set yet).
 */
function isSubjectApplicableToPupil(subject, pupilReligion) {
  const s = (subject || '').toLowerCase();
  const religion = (pupilReligion || '').trim().toLowerCase();

  const isChristianRS = s.includes('christian religious') || s === 'crs' || s === 'crk' || s.includes('bible knowledge');
  const isIslamicRS   = s.includes('islamic religious')   || s === 'irs' || s === 'irk' || s.includes('islamic studies');

  if (!isChristianRS && !isIslamicRS) return true; // not a religion subject at all

  if (religion === 'muslim' || religion === 'islam') {
    return !isChristianRS; // Muslim pupils excluded from Christian RS
  }
  if (religion === 'christian' || religion === 'christianity') {
    return !isIslamicRS; // Christian pupils excluded from Islamic RS
  }

  // Religion unset — don't hide either subject, admin/teacher hasn't specified
  return true;
}

window.isSubjectApplicableToPupil = isSubjectApplicableToPupil;

/* ======================================== 
   PAGINATION WITH DEFENSIVE CHECKS
======================================== */

function paginateTable(data, tbodyId, itemsPerPage = 20, renderRowCallback) {
  const table = document.getElementById(tbodyId);
  const tbody = table ? table.querySelector('tbody') : null;

  if (!tbody) {
    console.error(`paginateTable: no tbody found inside #${tbodyId}`);
    return;
  }

  if (!Array.isArray(data)) {
    console.error('paginateTable: data must be an array');
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color: var(--color-danger);">Invalid data format</td></tr>';
    return;
  }

  // Sanitize ID so hyphens don't break the JS function name
  const safeFuncKey = tbodyId.replace(/[^a-zA-Z0-9_]/g, '_');
  const paginationFuncName = `changePage_${safeFuncKey}`;

  // Clean up old pagination function to prevent memory leaks
  if (window[paginationFuncName]) {
    delete window[paginationFuncName];
  }

  let currentPage = 1;
  const totalPages = Math.ceil(data.length / itemsPerPage) || 1;

  function renderPage(page) {
    tbody.innerHTML = '';

    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;

    const start = (page - 1) * itemsPerPage;
    const pageData = data.slice(start, start + itemsPerPage);

    if (pageData.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding: var(--space-xl); color: var(--color-gray-600);">No data available</td></tr>';
      updatePaginationControls(1, 1);
      return;
    }

    pageData.forEach(item => {
      try {
        renderRowCallback(item, tbody);
      } catch (error) {
        console.error('Error rendering row:', error);
      }
    });

    updatePaginationControls(page, totalPages);
  }

  function updatePaginationControls(page, total) {
    const tableEl = tbody.parentElement;
    if (!tableEl || !tableEl.parentElement) return;

    const container = tableEl.parentElement;
    let paginationContainer = container.querySelector(`#pagination-${safeFuncKey}`);

    if (!paginationContainer) {
      paginationContainer = document.createElement('div');
      paginationContainer.className = 'pagination';
      paginationContainer.id = `pagination-${safeFuncKey}`;
      container.appendChild(paginationContainer);
    }

    paginationContainer.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 16px 0;
      flex-wrap: wrap;
    `;

    if (total <= 1) {
      paginationContainer.innerHTML = '';
      paginationContainer.style.display = 'none';
      return;
    }

    paginationContainer.style.display = 'flex';

    // Use data attributes + addEventListener — avoids hyphen identifier crash
    paginationContainer.innerHTML = `
      <button
        class="pagination-prev"
        ${page === 1 ? 'disabled' : ''}
        aria-label="Previous page"
        style="padding:6px 16px; border:1.5px solid #e2e8f0; background:${page === 1 ? '#f8fafc' : 'white'}; border-radius:8px; cursor:${page === 1 ? 'not-allowed' : 'pointer'}; color:${page === 1 ? '#94a3b8' : '#0f172a'}; font-weight:600; font-size:0.875rem;">
        ← Prev
      </button>
      <span
        class="page-info"
        role="status"
        aria-live="polite"
        style="font-size:0.875rem; color:#64748b; font-weight:500; white-space:nowrap;">
        Page ${page} of ${total}
      </span>
      <button
        class="pagination-next"
        ${page === total ? 'disabled' : ''}
        aria-label="Next page"
        style="padding:6px 16px; border:1.5px solid #e2e8f0; background:${page === total ? '#f8fafc' : 'white'}; border-radius:8px; cursor:${page === total ? 'not-allowed' : 'pointer'}; color:${page === total ? '#94a3b8' : '#0f172a'}; font-weight:600; font-size:0.875rem;">
        Next →
      </button>
    `;

    const prevBtn = paginationContainer.querySelector('.pagination-prev');
    const nextBtn = paginationContainer.querySelector('.pagination-next');

    if (prevBtn && page > 1) {
      prevBtn.addEventListener('click', function () {
        window[paginationFuncName](currentPage - 1);
      });
    }

    if (nextBtn && page < total) {
      nextBtn.addEventListener('click', function () {
        window[paginationFuncName](currentPage + 1);
      });
    }
  }

  window[paginationFuncName] = function (newPage) {
    if (newPage < 1 || newPage > totalPages) return;
    currentPage = newPage;
    renderPage(currentPage);
  };

  renderPage(1);
  console.log(`✓ Pagination initialized for ${tbodyId} (${data.length} items, ${totalPages} pages)`);
}

/* ======================================== 
   SECTION NAVIGATION WITH SAFETY CHECKS
======================================== */

const sectionLoaders = window.sectionLoaders = {
  dashboard:       loadTeacherDashboard,
  'my-classes':    loadMyClassesSection,
  'enter-results': loadResultsSection,
  attendance:      loadAttendanceSection,
  'traits-skills': loadTraitsSection,
  remarks:         loadRemarksSection,
  promotions:      loadPromotionSection,
  'lesson-notes':  () => window.loadLessonNotesSection?.()   // ← NEW
};

function showSection(sectionId) {
  if (!sectionId) {
    console.error('showSection called with no sectionId');
    return;
  }
  
  // FIXED: Check if data is loaded before showing sections
  if (!dataLoaded && sectionId !== 'dashboard') {
    window.showToast?.('Please wait for data to finish loading...', 'info', 3000);
    return;
  }
  
  document.querySelectorAll('.admin-card').forEach(card => card.style.display = 'none');

  // Reset result banners whenever navigating away from enter-results
  if (sectionId !== 'enter-results') {
    const bannersToReset = [
      'result-submission-controls',
      'result-locked-banner',
      'result-submission-status'
    ];
    bannersToReset.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  const section = document.getElementById(sectionId);
  if (section) {
    section.style.display = 'block';
  } else {
    console.warn(`Section ${sectionId} not found`);
  }
  
  document.querySelectorAll('.admin-sidebar a[data-section]').forEach(link => {
    link.classList.toggle('active', link.dataset.section === sectionId);
  });
  
  // FIXED: Safe loader execution
  if (typeof sectionLoaders[sectionId] === 'function') {
    try {
      sectionLoaders[sectionId]();
    } catch (error) {
      console.error(`Error loading section ${sectionId}:`, error);
      window.showToast?.(`Failed to load ${sectionId}`, 'danger');
    }
  }
  
  // Close mobile sidebar
  const sidebar = document.getElementById('teacher-sidebar');
  const hamburger = document.getElementById('hamburger');
  if (sidebar?.classList.contains('active')) {
    sidebar.classList.remove('active');
    hamburger?.classList.remove('active');
    hamburger?.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }
}

/* ======================================== 
   HAMBURGER MENU FOR MOBILE - FIXED VERSION
======================================== */

// Named handlers stored at module scope so they can be removed on re-init
let _teacherOutsideClickHandler = null;
let _teacherKeydownHandler = null;
let _teacherResizeHandler = null;
let _teacherResizeTimer = null;

function initTeacherHamburger() {
  // HARD GUARD: Prevent any chance of double-setup
  if (window.teacherSidebarInitialized === true) {
    console.log('✓ Teacher hamburger already initialized, skipping');
    return;
  }

  const hamburger = document.getElementById('hamburger');
  const sidebar = document.getElementById('teacher-sidebar');

  if (!hamburger || !sidebar) {
    console.warn('⚠️ Teacher hamburger or sidebar not found');
    console.log('Hamburger element:', hamburger);
    console.log('Sidebar element:', sidebar);
    return;
  }

  console.log('🔧 Initializing teacher hamburger menu...');

  // ── STEP 1: Remove ALL prior listeners on hamburger by cloning ──────────
  const freshHamburger = hamburger.cloneNode(true);
  hamburger.parentNode.replaceChild(freshHamburger, hamburger);

  // ── STEP 2: Remove any previously attached document-level handlers ───────
  if (_teacherOutsideClickHandler) {
    document.removeEventListener('click', _teacherOutsideClickHandler);
    _teacherOutsideClickHandler = null;
  }
  if (_teacherKeydownHandler) {
    document.removeEventListener('keydown', _teacherKeydownHandler);
    _teacherKeydownHandler = null;
  }
  if (_teacherResizeHandler) {
    window.removeEventListener('resize', _teacherResizeHandler);
    _teacherResizeHandler = null;
  }
  clearTimeout(_teacherResizeTimer);

  // ── STEP 3: Helper functions using fresh lookups (no stale closures) ─────
  function closeSidebar() {
    const sb = document.getElementById('teacher-sidebar');
    const hb = document.getElementById('hamburger');
    if (!sb || !hb) return;
    sb.classList.remove('active');
    hb.classList.remove('active');
    hb.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  // ── STEP 4: Attach hamburger click listener to the CLONED element ────────
  freshHamburger.addEventListener('click', function (e) {
    e.stopPropagation();
    const sb = document.getElementById('teacher-sidebar');
    const hb = document.getElementById('hamburger');
    if (!sb || !hb) return;

    const isActive = sb.classList.toggle('active');
    hb.classList.toggle('active', isActive);
    hb.setAttribute('aria-expanded', String(isActive));
    document.body.style.overflow = isActive ? 'hidden' : '';

    console.log('📱 Teacher sidebar toggled:', isActive ? 'OPEN' : 'CLOSED');
  });
  console.log('✓ Click listener attached to hamburger');

  // ── STEP 5: Outside-click handler (named so it can be removed later) ─────
  _teacherOutsideClickHandler = function (e) {
    const sb = document.getElementById('teacher-sidebar');
    const hb = document.getElementById('hamburger');
    if (!sb || !hb) return;
    if (
      sb.classList.contains('active') &&
      !sb.contains(e.target) &&
      !hb.contains(e.target)
    ) {
      closeSidebar();
    }
  };
  document.addEventListener('click', _teacherOutsideClickHandler);

  // ── STEP 6: Navigation links close sidebar on mobile ─────────────────────
  sidebar.querySelectorAll('a[data-section]').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 1024) closeSidebar();
    });
  });

  // ── STEP 7: Escape key ────────────────────────────────────────────────────
  _teacherKeydownHandler = function (e) {
    if (e.key === 'Escape') {
      const sb = document.getElementById('teacher-sidebar');
      if (sb?.classList.contains('active')) {
        closeSidebar();
        document.getElementById('hamburger')?.focus();
      }
    }
  };
  document.addEventListener('keydown', _teacherKeydownHandler);

  // ── STEP 8: Resize handler ────────────────────────────────────────────────
  _teacherResizeHandler = function () {
    clearTimeout(_teacherResizeTimer);
    _teacherResizeTimer = setTimeout(() => {
      const sb = document.getElementById('teacher-sidebar');
      if (window.innerWidth > 1024 && sb?.classList.contains('active')) {
        closeSidebar();
      }
    }, 250);
  };
  window.addEventListener('resize', _teacherResizeHandler);

  // ── STEP 9: Set flag LAST ────────────────────────────────────────────────
  window.teacherSidebarInitialized = true;
  console.log('✅ Teacher hamburger menu initialized successfully');
}

// DON'T call initTeacherHamburger() here!
// It is called from initTeacherPortal() after data is fully loaded.
console.log('✓ Teacher hamburger function defined');

/* ======================================== 
   PORTAL INITIALIZATION
======================================== */

function initTeacherPortal() {
  if (!dataLoaded) {
    console.error('initTeacherPortal called before data loaded');
    return;
  }
  
  setupAllEventListeners();
  
  // CRITICAL FIX: Initialize hamburger HERE after DOM is fully loaded
  initTeacherHamburger();
  
  window.getCurrentSettings().then(settings => {
    // Set default term in all selects
    ['result-term', 'attendance-term', 'traits-term', 'remarks-term'].forEach(id => {
      const select = document.getElementById(id);
      if (select) select.value = settings.term;
    });
    
    showSection('dashboard');
    console.log('✓ Teacher portal ready (v8.1.0) - Current term:', settings.term);

    // Load targeted announcements for this teacher
    if (typeof window.loadAnnouncementsForUser === 'function' && currentUser) {
      window.loadAnnouncementsForUser(
        'teacher',
        currentUser.uid,
        null,
        'announcements-banner-container'
      );
    }
    
    // Setup sidebar navigation
    document.querySelectorAll('.admin-sidebar a[data-section]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const section = link.dataset.section;
        if (section) showSection(section);
      });
    });
  }).catch(error => {
    console.error('Failed to load settings:', error);
    showSection('dashboard');
  });
}

function setupAllEventListeners() {
  const saveResultsBtn   = document.getElementById('save-results-btn');
  const saveAttendanceBtn = document.getElementById('save-attendance-btn');
  const saveTraitsBtn    = document.getElementById('save-traits-btn');
  const saveRemarksBtn   = document.getElementById('save-remarks-btn');

  if (saveResultsBtn)    saveResultsBtn.addEventListener('click', saveAllResults);
  if (saveAttendanceBtn) saveAttendanceBtn.addEventListener('click', saveAllAttendance);
  if (saveTraitsBtn)     saveTraitsBtn.addEventListener('click', saveBulkTraitsAndSkills); // ✅ FIXED name
  if (saveRemarksBtn)    saveRemarksBtn.addEventListener('click', saveRemarks);

  const resultTerm    = document.getElementById('result-term');
  const resultSubject = document.getElementById('result-subject');
  if (resultTerm)    resultTerm.addEventListener('change', loadResultsTable);
  if (resultSubject) resultSubject.addEventListener('change', loadResultsTable);

  const traitsTerm = document.getElementById('traits-term');
  if (traitsTerm) traitsTerm.addEventListener('change', loadBulkTraitsTable);

  const traitsPupil = document.getElementById('traits-pupil');
  if (traitsPupil) traitsPupil.closest('.form-group')?.remove();

  const remarksPupil = document.getElementById('remarks-pupil');
  const remarksTerm  = document.getElementById('remarks-term');
  if (remarksPupil) remarksPupil.addEventListener('change', loadRemarksData);
  if (remarksTerm)  remarksTerm.addEventListener('change', () => {
    if (remarksPupil?.value) loadRemarksData();
  });

  const attendanceTerm = document.getElementById('attendance-term');
  if (attendanceTerm) attendanceTerm.addEventListener('change', () => {
    const loader = window.sectionLoaders?.['attendance'];
    if (typeof loader === 'function') loader();
    else loadAttendanceSection();
  });

  console.log('✓ All event listeners connected');
}

/* ======================================== 
   DASHBOARD WITH VALIDATION
======================================== */

function getTimeBasedGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function renderDashboardGreeting() {
  const greetingEl = document.getElementById('dashboard-greeting');
  if (!greetingEl) return;

  const greeting = getTimeBasedGreeting();
  const displayName = teacherName || 'Teacher';

  greetingEl.textContent = `${greeting}, ${displayName}`;
}

window.renderDashboardGreeting = renderDashboardGreeting;

async function loadTeacherDashboard() {
  renderDashboardGreeting();

  const classCountEl = document.getElementById('my-class-count');
  const pupilCountEl = document.getElementById('my-pupil-count');
  const headerClassCount = document.getElementById('header-class-count');
  const headerPupilCount = document.getElementById('header-pupil-count');
  
  const classes = getValidClasses();
  const pupils = getValidPupils();
  
  if (classCountEl) classCountEl.textContent = classes.length;
  if (pupilCountEl) pupilCountEl.textContent = pupils.length;
  if (headerClassCount) headerClassCount.textContent = classes.length;
  if (headerPupilCount) headerPupilCount.textContent = pupils.length;
}

/* ======================================== 
   MY CLASSES WITH VALIDATION
======================================== */

function loadMyClassesSection() {
  const table = document.getElementById('pupils-in-class-table');
  if (!table) {
    console.warn('pupils-in-class-table not found');
    return;
  }
  
  const tbody = table.querySelector('tbody');
  if (!tbody) {
    console.warn('tbody not found in pupils-in-class-table');
    return;
  }
  
  const classes = getValidClasses();
  const pupils = getValidPupils();
  
  if (classes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--color-gray-600);">No classes assigned to you yet. Contact admin.</td></tr>';
    return;
  }
  
  if (pupils.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--color-gray-600);">No pupils in your assigned classes yet.</td></tr>';
    return;
  }
  
  // Use pagination correctly with table ID (not tbody ID)
  paginateTable(pupils, 'pupils-in-class-table', 20, (pupil, tbodyEl) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Pupil Name">${pupil.name || 'Unknown'}</td>
      <td data-label="Gender">${pupil.gender || '-'}</td>
      <td data-label="Admission No">${pupil.admissionNo || '-'}</td>
    `;
    tbodyEl.appendChild(tr);
  });
}

/* ======================================== 
   RESULTS 
======================================== */

/* ======================================== 
   RESULTS AUTOSAVE (prevents lost work on
   pagination or page refresh)
======================================== */

// Holds every pupil's typed-but-not-yet-saved scores for the class/term/
// subject currently on screen. Rebuilt each time loadResultsTable() runs.
let resultsEditBuffer = {};

// Identifies which browser-storage slot belongs to the current
// class + term + subject combination
let currentResultsStorageKey = null;

function getResultsStorageKey(classId, term, subject) {
  return `fahmid_results_draft_${currentUser?.uid || 'anon'}_${classId}_${term}_${subject}`;
}

function saveResultsBufferToStorage() {
  if (!currentResultsStorageKey) return;
  try {
    localStorage.setItem(currentResultsStorageKey, JSON.stringify(resultsEditBuffer));
  } catch (e) {
    console.warn('Could not save results draft to local storage:', e);
  }
}

function loadResultsBufferFromStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('Could not read results draft from local storage:', e);
    return {};
  }
}

function clearResultsBufferStorage() {
  if (!currentResultsStorageKey) return;
  try {
    localStorage.removeItem(currentResultsStorageKey);
  } catch (e) {}
}

function loadResultsSection() {
  if (!ensureDataLoaded('loadResultsSection')) return;

  const classSelect = document.getElementById('result-class');
  const classGroupEl = document.getElementById('result-class-group');

  if (!classSelect) return;

  const classes = getValidClasses();

  // Rebuild options
  classSelect.innerHTML = '<option value="">-- Select Class --</option>';
  classes.forEach(cls => {
    const opt = document.createElement('option');
    opt.value = cls.id;
    opt.textContent = cls.name;
    classSelect.appendChild(opt);
  });

  // Auto-select single class OR show selector for multi-class
  if (classes.length === 1) {
    classSelect.value = classes[0].id;
    if (classGroupEl) classGroupEl.style.display = 'none';
} else {
    classSelect.value = classes[0].id;  // ← auto-select first class
    if (classGroupEl) classGroupEl.style.display = '';
}

const currentValue = classSelect.value;  // will be classes[0].id in both cases
const freshClassSelect = classSelect.cloneNode(true);
classSelect.parentNode.replaceChild(freshClassSelect, classSelect);
freshClassSelect.value = currentValue;   // restore on clone

freshClassSelect.addEventListener('change', function () {
    populateSubjectsForClass(this.value);
    checkResultLockStatus();
    loadResultsTable();
});

populateSubjectsForClass(freshClassSelect.value);  // now always has a valid value
loadResultsTable();
}

function populateSubjectsForClass(classId) {
    const subjectSelect = document.getElementById('result-subject');
    if (!subjectSelect) return;

    subjectSelect.innerHTML = '<option value="">-- Select Subject --</option>';

    if (!classId) return;

    const cls = assignedClasses.find(c => c.id === classId);

    if (!cls) {
        console.warn('populateSubjectsForClass: class not found for id:', classId);
        return;
    }

    const subjects = Array.isArray(cls.subjects) ? cls.subjects : [];

    if (subjects.length === 0) {
        console.warn('populateSubjectsForClass: class has no subjects:', cls.name);
        window.showToast?.(`No subjects assigned to ${cls.name}. Contact admin.`, 'warning', 5000);
        return;
    }

    subjects.forEach(subject => {
        const opt = document.createElement('option');
        opt.value = subject;
        opt.textContent = subject;
        subjectSelect.appendChild(opt);
    });

    console.log(`✓ Populated ${subjects.length} subject(s) for ${cls.name}`);
}

async function loadResultsTable() {
  const container = document.getElementById('results-entry-table-container');
  const saveBtn = document.getElementById('save-results-btn');
  const term = document.getElementById('result-term')?.value;
  const subject = document.getElementById('result-subject')?.value;
  const classSelect = document.getElementById('result-class');
  const selectedClassId = classSelect?.value;
  
  if (!container || !term || !subject || !selectedClassId) {
    if (container) container.innerHTML = '';
    if (saveBtn) saveBtn.hidden = true;
    currentResultsStorageKey = null;
    return;
  }

  // Every autosave is tied to this exact class + term + subject
  currentResultsStorageKey = getResultsStorageKey(selectedClassId, term, subject);

  // ── SKELETON LOADER ──────────────────────────────────────────────────────
  const skeletonRows = Array.from({ length: 5 }, () => `
    <div class="tp-result-skeleton-card">
      <div class="tp-skeleton-name tp-skeleton"></div>
      <div class="tp-skeleton-fields">
        <div class="tp-skeleton-field">
          <div class="tp-skeleton tp-skeleton--label"></div>
          <div class="tp-skeleton tp-skeleton--input"></div>
        </div>
        <div class="tp-skeleton-field">
          <div class="tp-skeleton tp-skeleton--label"></div>
          <div class="tp-skeleton tp-skeleton--input"></div>
        </div>
        <div class="tp-skeleton-field">
          <div class="tp-skeleton tp-skeleton--label"></div>
          <div class="tp-skeleton tp-skeleton--input"></div>
        </div>
      </div>
      <div class="tp-skeleton tp-skeleton--total"></div>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="tp-results-skeleton" aria-label="Loading results…">
      ${skeletonRows}
    </div>
  `;
  if (saveBtn) saveBtn.hidden = true;
  // ────────────────────────────────────────────────────────────────────────

  const classFilteredPupils = allPupils.filter(p => {
    if (p.class?.id !== selectedClassId) return false;
    return window.isSubjectApplicableToPupil
      ? window.isSubjectApplicableToPupil(subject, p.religion)
      : true;
  });

  if (classFilteredPupils.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:var(--color-gray-600);">No pupils found in this class for this subject.</p>';
    if (saveBtn) saveBtn.hidden = true;
    return;
  }
  
  try {
    const settings = await window.getCurrentSettings();
    const currentSession = settings.session;
    
    const resultsMap = {};

    // Previously: one Firestore .get() per pupil in this class — N
    // reads from the browser. Now: a single call to the Worker's
    // listDrafts(), which already filters by class/session/term/
    // subject server-side.
    const draftsQuery = new URLSearchParams({
      classId: selectedClassId,
      session: currentSession,
      term,
      subject,
    });
    const { drafts } = await teacherApiGet(`/api/teacher/results/drafts?${draftsQuery}`);

    drafts.forEach(data => {
      resultsMap[data.pupilId] = {
        ca:         data.caScore   || 0,
        exam:       data.examScore || 0,
        assignment: data.assignment !== undefined ? data.assignment : '',
        midterm:    data.midterm    !== undefined ? data.midterm    : '',
        project:    data.project    !== undefined ? data.project    : '',
      };
    });

    // Rebuild the working copy for this class/term/subject. Anything the
    // teacher typed but never saved (recovered from local storage) takes
    // priority over the last saved draft, so nothing typed gets lost.
    const storedBuffer = loadResultsBufferFromStorage(currentResultsStorageKey);
    resultsEditBuffer = {};
    let hasRestoredEdits = false;

    classFilteredPupils.forEach(pupil => {
      if (storedBuffer[pupil.id]) {
        resultsEditBuffer[pupil.id] = { ...storedBuffer[pupil.id] };
        hasRestoredEdits = true;
      } else if (resultsMap[pupil.id]) {
        resultsEditBuffer[pupil.id] = {
          assignment: parseFloat(resultsMap[pupil.id].assignment) || 0,
          midterm:    parseFloat(resultsMap[pupil.id].midterm)    || 0,
          project:    parseFloat(resultsMap[pupil.id].project)    || 0,
          exam:       parseFloat(resultsMap[pupil.id].exam)       || 0,
        };
      }
    });

    if (hasRestoredEdits) {
      window.showToast?.('Restored your unsaved scores from before.', 'info', 4000);
    }
    
    // Rejection banner check
    let rejectionBanner = '';
    const encodedSession = currentSession.replace(/\//g, '-');
    const submissionId = `${selectedClassId}_${encodedSession}_${term}_${subject}`;
      
    try {
      const { submission: submissionData } = await teacherApiGet(
        `/api/teacher/results/submissions/${encodeURIComponent(submissionId)}`
      );
      {
        if (submissionData.status === 'rejected' && submissionData.rejectionReason) {
          rejectionBanner = `
            <div class="tp-rejection-banner" style="margin-bottom: var(--tp-space-5);">
              <div style="display:flex;gap:var(--tp-space-3);align-items:flex-start;">
                <div style="font-size:1.25rem;">⚠️</div>
                <div>
                  <strong style="color:#991b1b;">Results Rejected by Admin</strong>
                  <p style="margin:6px 0 0;font-size:.875rem;color:#7f1d1d;">${submissionData.rejectionReason}</p>
                  <p style="margin:8px 0 0;font-size:.8125rem;color:#b91c1c;">Your results are now editable. Please correct and resubmit.</p>
                </div>
              </div>
            </div>
          `;
        }
      }
    } catch (submissionError) {
      console.log('No submission found or error checking submission:', submissionError.code);
    }
    
    // ── BUILD CARD-BASED LAYOUT (works on both mobile and desktop) ──────────
    container.innerHTML = `
      ${rejectionBanner}
      <div class="tp-ca-info-bar">
        <strong>CA Breakdown:</strong> Assignment (max 10) + Mid-term (max 20) + Project (max 10) = CA Total (40).
        The system auto-calculates the CA Total as you type. Exam is entered separately (max 60).
      </div>
      <div id="results-cards-container" class="tp-result-cards"></div>
      <div id="results-pagination" class="pagination" style="display:none;"></div>
    `;

    // ── RENDER CARDS WITH PAGINATION ────────────────────────────────────────
    const ITEMS_PER_PAGE = 15;
    let currentPage = 1;
    const totalPages = Math.ceil(classFilteredPupils.length / ITEMS_PER_PAGE);

    function renderResultCards(page) {
      const cardsContainer = document.getElementById('results-cards-container');
      if (!cardsContainer) return;

      const start = (page - 1) * ITEMS_PER_PAGE;
      const pageData = classFilteredPupils.slice(start, start + ITEMS_PER_PAGE);

      cardsContainer.innerHTML = pageData.map(pupil => {
        // Reads from the working copy (unsaved edits + restored drafts),
        // not the raw Firestore draft, so values survive page switches
        const existing = resultsEditBuffer[pupil.id] || { assignment: '', midterm: '', project: '', exam: '' };
        const caTotal = (parseFloat(existing.assignment) || 0) + (parseFloat(existing.midterm) || 0) + (parseFloat(existing.project) || 0);
        const grandTotal = caTotal + (parseFloat(existing.exam) || 0);

        return `
          <div class="tp-result-card" data-pupil-id="${pupil.id}">
            <div class="tp-result-card__name">${pupil.name}</div>

            <div class="tp-result-card__ca-grid">
              <div class="tp-result-card__field">
                <label class="tp-result-card__label">ASSIGNMENT <span class="tp-result-card__max">(max 10)</span></label>
                <input type="number" min="0" max="10" step="0.5"
                       class="tp-result-card__input"
                       value="${existing.assignment !== '' && existing.assignment !== undefined ? existing.assignment : ''}"
                       data-pupil="${pupil.id}" data-field="assignment"
                       placeholder="0–10">
              </div>
              <div class="tp-result-card__field">
                <label class="tp-result-card__label">MID-TERM <span class="tp-result-card__max">(max 20)</span></label>
                <input type="number" min="0" max="20" step="0.5"
                       class="tp-result-card__input"
                       value="${existing.midterm !== '' && existing.midterm !== undefined ? existing.midterm : ''}"
                       data-pupil="${pupil.id}" data-field="midterm"
                       placeholder="0–20">
              </div>
              <div class="tp-result-card__field">
                <label class="tp-result-card__label">PROJECT <span class="tp-result-card__max">(max 10)</span></label>
                <input type="number" min="0" max="10" step="0.5"
                       class="tp-result-card__input"
                       value="${existing.project !== '' && existing.project !== undefined ? existing.project : ''}"
                       data-pupil="${pupil.id}" data-field="project"
                       placeholder="0–10">
              </div>
            </div>

            <div class="tp-result-card__totals">
              <div class="tp-result-card__ca-total">
                <span class="tp-result-card__total-label">CA TOTAL (AUTO)</span>
                <span class="tp-result-card__total-value tp-result-card__total-value--ca"
                      id="ca-total-${pupil.id}">${caTotal > 0 ? caTotal : '–'}</span>
              </div>
              <div class="tp-result-card__exam-field">
                <label class="tp-result-card__label">EXAM SCORE <span class="tp-result-card__max">(max 60)</span></label>
                <input type="number" min="0" max="60" step="0.5"
                       class="tp-result-card__input tp-result-card__input--exam"
                       value="${existing.exam !== '' && existing.exam !== undefined ? existing.exam : ''}"
                       data-pupil="${pupil.id}" data-field="exam"
                       placeholder="0–60">
              </div>
              <div class="tp-result-card__grand-total">
                <span class="tp-result-card__total-label">TOTAL SCORE</span>
                <span class="tp-result-card__total-value tp-result-card__total-value--grand"
                      id="grand-total-${pupil.id}"
                      data-score="${grandTotal}">${grandTotal > 0 ? grandTotal : '–'}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Apply colour coding to already-saved totals
      cardsContainer.querySelectorAll('.tp-result-card__total-value--grand').forEach(el => {
        applyTotalColour(el, parseFloat(el.dataset.score) || 0);
      });

      // Pagination UI
      const paginationEl = document.getElementById('results-pagination');
      if (paginationEl) {
        if (totalPages > 1) {
          paginationEl.style.display = 'flex';
          paginationEl.innerHTML = `
            <button onclick="window._resultChangePage(${page - 1})" ${page === 1 ? 'disabled' : ''}>Previous</button>
            <span class="page-info">Page ${page} of ${totalPages}</span>
            <button onclick="window._resultChangePage(${page + 1})" ${page === totalPages ? 'disabled' : ''}>Next</button>
          `;
        } else {
          paginationEl.style.display = 'none';
        }
      }

      attachResultInputListeners();
    }

    window._resultChangePage = function(newPage) {
      if (newPage < 1 || newPage > totalPages) return;
      currentPage = newPage;
      renderResultCards(currentPage);
    };

    renderResultCards(1);
    // ────────────────────────────────────────────────────────────────────────

    if (saveBtn) saveBtn.hidden = false;
    
  } catch (err) {
    console.error('Error loading results table:', err);
    window.handleError?.(err, 'Failed to load results');
    container.innerHTML = '<p style="text-align:center; color:var(--color-danger);">Error loading results. Please try again.</p>';
    if (saveBtn) saveBtn.hidden = true;
  }
  
  await checkResultLockStatus();
}

function applyTotalColour(el, score) {
  if (score >= 75)      el.style.color = '#16a34a';
  else if (score >= 50) el.style.color = '#2563eb';
  else if (score >= 40) el.style.color = '#d97706';
  else if (score > 0)   el.style.color = '#dc2626';
  else                  el.style.color = '';
}

function attachResultInputListeners() {
  const container = document.getElementById('results-entry-table-container');
  if (!container) return;

  container.querySelectorAll('input[type="number"]').forEach(input => {
    input.addEventListener('input', (e) => {
      const field   = e.target.dataset.field;
      const pupilId = e.target.dataset.pupil;
      let value     = parseFloat(e.target.value);

      const maxMap = { assignment: 10, midterm: 20, project: 10, exam: 60 };
      const max    = maxMap[field];

      if (!isNaN(value) && max !== undefined) {
        if (value > max) { e.target.value = max; value = max; window.showToast?.(`Maximum for ${field} is ${max}`, 'warning', 2500); }
        if (value < 0)   { e.target.value = 0;   value = 0; }
      }

      // Keep the working copy (and its local storage backup) up to date on
      // every keystroke, for every pupil, on every page. This is what
      // stops "Next"/"Prev" and a page refresh from wiping unsaved scores.
      if (!resultsEditBuffer[pupilId]) {
        resultsEditBuffer[pupilId] = { assignment: 0, midterm: 0, project: 0, exam: 0 };
      }
      resultsEditBuffer[pupilId][field] = isNaN(value) ? 0 : value;
      saveResultsBufferToStorage();

      const card = e.target.closest('.tp-result-card');
      if (!card) return;

      const get = (f) => parseFloat(card.querySelector(`[data-field="${f}"]`)?.value) || 0;
      const caTotal    = get('assignment') + get('midterm') + get('project');
      const grandTotal = caTotal + get('exam');

      const caTotalEl    = document.getElementById(`ca-total-${pupilId}`);
      const grandTotalEl = document.getElementById(`grand-total-${pupilId}`);

      if (caTotalEl)    caTotalEl.textContent    = caTotal    > 0 ? caTotal.toFixed(caTotal % 1 !== 0 ? 1 : 0)       : '–';
      if (grandTotalEl) {
        grandTotalEl.textContent = grandTotal > 0 ? grandTotal.toFixed(grandTotal % 1 !== 0 ? 1 : 0) : '–';
        applyTotalColour(grandTotalEl, grandTotal);
      }
    });
  });
}

/**
 * ✅ FIXED: Check result lock status with clarified error logging
 * Prevents misleading console errors and handles all permission scenarios
 */
async function checkResultLockStatus() {
    const term = document.getElementById('result-term')?.value;
    const subject = document.getElementById('result-subject')?.value;
    
    if (!term || !subject || assignedClasses.length === 0) {
        hideAllResultBanners();
        return;
    }
    
    const classSelect = document.getElementById('result-class');
    const classId = classSelect?.value || assignedClasses[0]?.id;
    const selectedClassObj = assignedClasses.find(c => c.id === classId);
    const className = selectedClassObj?.name || assignedClasses[0]?.name || 'your class';
    
    try {
        const settings = await window.getCurrentSettings();
        const session = settings.session;
        
        // Encode session to avoid Firestore path issues (e.g., "2025/2026" → "2025-2026")
        const encodedSession = session.replace(/\//g, '-');
        
        // ✅ FIX 1: Check lock status with clarified error handling
        let lockStatus = { locked: false };
        
        try {
            lockStatus = await window.resultLocking.isLocked(classId, term, subject, encodedSession);
            
            // Note: If lock check returned 'note' field, it means permission denied or doesn't exist
            // This is SAFE - we assume unlocked and allow editing
            if (lockStatus.note) {
                console.log('✓ No lock found, allowing edits');
            }
        } catch (lockError) {
            // This catch should rarely trigger since isLocked() handles its own errors
            console.log('✓ Lock check failed, assuming no lock exists (safe to edit)');
            lockStatus = { locked: false };
        }
        
        // If results are locked, disable editing
        if (lockStatus.locked) {
            showLockedBanner(lockStatus);
            hideSubmissionControls();
            disableResultInputs();
            return;
        }
        
        // Check submission status via the Worker API instead of reading
        // result_submissions directly. The submission ID scheme
        // (classId_encodedSession_term_subject) is unchanged, so this
        // still hits the exact same document server-side.
        let submissionExists = false;
        let submissionData = null;

        try {
            const submissionId = `${classId}_${encodedSession}_${term}_${subject}`;
            const { submission } = await teacherApiGet(
                `/api/teacher/results/submissions/${encodeURIComponent(submissionId)}`
            );
            submissionExists = true;
            submissionData = submission;
        } catch (submissionError) {
            if (submissionError.code === 'SUBMISSION_NOT_FOUND') {
                console.log('✓ No submission found for these results');
            } else {
                console.error('❌ Unexpected error checking submission status:', submissionError);
                window.showToast?.(
                    'Connection issue detected. Changes may not save properly.',
                    'warning',
                    4000
                );
            }
            // Continue execution - assume no submission
        }
        
        // Handle submission status
        if (submissionExists && submissionData) {
            if (submissionData.status === 'pending') {
                showSubmissionStatusBanner(submissionData);
                hideSubmissionControls();
                disableResultInputs();
                return;
            } else if (submissionData.status === 'rejected') {
                // Rejected - teacher can edit and resubmit
                if (window.showToast) {
                    window.showToast(
                        'Your previous submission was rejected. You can now edit and resubmit.',
                        'warning',
                        6000
                    );
                }
                showSubmissionControls(term, subject, className);
                hideAllResultBanners();
                enableResultInputs();
                return;
            } else if (submissionData.status === 'approved') {
                // Approved - results are finalized, no editing
                showApprovedBanner(submissionData);
                hideSubmissionControls();
                disableResultInputs();
                return;
            }
        }
        
        // Default state: Not locked, not submitted - allow editing
        console.log('✓ Results are editable');
        showSubmissionControls(term, subject, className);
        hideAllResultBanners();
        enableResultInputs();
        
    } catch (error) {
        // ✅ FIX 3: Final catch-all with better diagnostics
        console.error('❌ Critical error in checkResultLockStatus:', error.code || error.message);
        
        // Show user-friendly message
        if (window.showToast) {
            if (error.code === 'unavailable') {
                window.showToast(
                    'Connection issue. Your work may not save. Check your internet.',
                    'danger',
                    8000
                );
            } else {
                window.showToast(
                    'Could not verify result status. Proceeding with caution.',
                    'warning',
                    5000
                );
            }
        }
        
        // Default to safe state: allow editing but warn user
        hideAllResultBanners();
        showSubmissionControls(term, subject, className);
        enableResultInputs();
    }
}

/**
 * ✅ NEW: Show approved banner
 */
function showApprovedBanner(submissionData) {
    const banner = document.getElementById('result-locked-banner');
    const detailsDiv = document.getElementById('lock-details');
    
    if (!banner || !detailsDiv) return;
    
    // submissionData now comes from the Worker API, where timestamps
    // are plain ISO strings — not Firestore Timestamps — so this is
    // new Date(...), not .toDate().
    const approvedDate = submissionData.approvedAt 
        ? new Date(submissionData.approvedAt).toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })
        : 'Unknown';
    
    detailsDiv.innerHTML = `
        <div style="font-size: var(--text-sm); color: var(--color-gray-600);">
            <strong>Status:</strong> Approved and locked<br>
            <strong>Approved on:</strong> ${approvedDate}<br>
            <strong>Note:</strong> These results are finalized and cannot be edited.
        </div>
    `;
    
    banner.style.display = 'block';
}

// Make globally available
window.showApprovedBanner = showApprovedBanner;

/**
 * Show locked banner
 */
function showLockedBanner(lockStatus) {
    const banner = document.getElementById('result-locked-banner');
    const detailsDiv = document.getElementById('lock-details');
    
    if (!banner || !detailsDiv) return;
    
    const lockedDate = lockStatus.lockedAt 
        ? lockStatus.lockedAt.toDate().toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
        : 'Unknown';
    
    detailsDiv.innerHTML = `
        <div style="font-size: var(--text-sm); color: var(--color-gray-600);">
            <strong>Locked on:</strong> ${lockedDate}<br>
            <strong>Reason:</strong> ${lockStatus.reason || 'Approved by admin'}
        </div>
    `;
    
    banner.style.display = 'block';
}

/**
 * Show submission status banner
 */
function showSubmissionStatusBanner(submissionData) {
    const banner = document.getElementById('result-submission-status');
    const dateEl = document.getElementById('submitted-date');
    
    if (!banner || !dateEl) return;
    
    // Same note as showApprovedBanner: ISO string from the API now,
    // not a Firestore Timestamp.
    const submittedDate = submissionData.submittedAt 
        ? new Date(submissionData.submittedAt).toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })
        : 'Unknown';
    
    dateEl.textContent = submittedDate;
    banner.style.display = 'block';
}

/**
 * Show submission controls
 */
function showSubmissionControls(term, subject, className) {
    const controls = document.getElementById('result-submission-controls');
    
    if (!controls) return;
    
    document.getElementById('submission-class-name').textContent = className;
    document.getElementById('submission-term').textContent = term;
    document.getElementById('submission-subject').textContent = subject;
    
    // Count pupils with results
    const inputs = document.querySelectorAll('#results-entry-table-container input[type="number"]');
    const pupilIds = new Set();
    
    inputs.forEach(input => {
        const pupilId = input.dataset.pupil;
        const value = parseFloat(input.value) || 0;
        
        if (value > 0 && pupilId) {
            pupilIds.add(pupilId);
        }
    });
    
    document.getElementById('submission-pupil-count').textContent = pupilIds.size;
    
    controls.style.display = 'block';
}

/**
 * Hide submission controls
 */
function hideSubmissionControls() {
    const controls = document.getElementById('result-submission-controls');
    if (controls) controls.style.display = 'none';
}

/**
 * Hide all banners
 */
function hideAllResultBanners() {
    const lockedBanner = document.getElementById('result-locked-banner');
    const statusBanner = document.getElementById('result-submission-status');
    
    if (lockedBanner) lockedBanner.style.display = 'none';
    if (statusBanner) statusBanner.style.display = 'none';
}

/**
 * Disable result inputs
 */
function disableResultInputs() {
    const inputs = document.querySelectorAll('#results-entry-table-container input[type="number"]');
    inputs.forEach(input => {
        input.disabled = true;
        input.style.background = '#f3f4f6';
        input.style.cursor = 'not-allowed';
    });
    
    const saveBtn = document.getElementById('save-results-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.5';
        saveBtn.style.cursor = 'not-allowed';
    }
}

/**
 * Enable result inputs
 */
function enableResultInputs() {
    const inputs = document.querySelectorAll('#results-entry-table-container input[type="number"]');
    inputs.forEach(input => {
        input.disabled = false;
        input.style.background = '';
        input.style.cursor = '';
    });
    
    const saveBtn = document.getElementById('save-results-btn');
    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.style.opacity = '';
        saveBtn.style.cursor = '';
    }
}

/**
 * ✅ FIXED: Encode session for document ID, use original for data
 */
async function submitResultsForApproval() {
    const term = document.getElementById('result-term')?.value;
    const subject = document.getElementById('result-subject')?.value;
    
    if (!term || !subject || assignedClasses.length === 0) {
        if (window.showToast) {
            window.showToast('Please select term and subject', 'error');
        }
        return;
    }

    const classSelect = document.getElementById('result-class');
    const selectedClassId = classSelect?.value;

    if (!selectedClassId) {
      window.showToast?.('Please select a class before submitting.', 'warning');
      return;
    }

    const selectedClass = assignedClasses.find(c => c.id === selectedClassId);
    if (!selectedClass) {
      window.showToast?.('Selected class not found. Please refresh and try again.', 'danger');
      return;
    }

    const classId = selectedClass.id;
    const className = selectedClass.name;

    const submitBtn = document.getElementById('submit-results-btn');
    const originalBtnText = submitBtn?.innerHTML || 'Submit for Approval';

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
        }

        // ──────────────────────────────────────────────────────────────────
        // NOTE: the old "canDirectPublish" bypass (trusted teachers writing
        // straight to the results collection, skipping admin approval) is
        // intentionally NOT included here. The Worker's submitResults()
        // only implements the normal approval path — direct-publish is a
        // separate, approval-bypassing feature that deserves its own
        // deliberate design on the backend rather than being ported
        // silently. Every submission now goes through admin review.
        // ──────────────────────────────────────────────────────────────────

        const settings = await window.getCurrentSettings();
        const session = settings.session;

        const confirmed = confirm(
            `Submit results for approval?\n\n` +
            `Class: ${className}\n` +
            `Subject: ${subject}\n` +
            `Term: ${term}\n\n` +
            `Once submitted, you cannot edit until admin reviews.`
        );

        if (!confirmed) {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnText;
            }
            return;
        }

        // The Worker looks up the saved drafts itself to build the
        // submission (pupil count, roster ownership, lock checks) —
        // the browser no longer queries results_draft directly.
        await teacherApiPost('/api/teacher/results/submissions', {
            classId,
            session,
            term,
            subject,
        });

        console.log('✅ Results submitted for approval:', `${classId}_${term}_${subject}`);

        window.showToast?.(
            'Results submitted for admin approval successfully!',
            'success',
            5000
        );

        await checkResultLockStatus();
        await loadResultsTable();

    } catch (error) {
        console.error('Error in submitResultsForApproval:', error);

        const errorMessage = (error.code === 'FORBIDDEN' || error.code === 'UNAUTHORIZED')
            ? 'Permission denied. Please contact your administrator.'
            : error.message || 'Failed to submit results. Please try again.';

        window.showToast?.(errorMessage, 'error', 6000);

    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
        }
    }
}

window.checkResultLockStatus = checkResultLockStatus;
window.submitResultsForApproval = submitResultsForApproval;

/**
 * ✅ FIXED: Save results with click guard to prevent double execution
 */

// Add flag to prevent simultaneous saves
let isSavingResults = false;

async function saveAllResults() {
  if (isSavingResults) {
    console.log('Save already in progress, ignoring click');
    return;
  }

  const term       = document.getElementById('result-term')?.value;
  const subject    = document.getElementById('result-subject')?.value;
  const classSelect = document.getElementById('result-class');
  const selectedClassId = classSelect?.value;

  if (!term || !subject) {
    window.showToast?.('Select term and subject first', 'warning');
    return;
  }
  if (!selectedClassId) {
    window.showToast?.('Please select a class first', 'warning');
    return;
  }

  const selectedClass = assignedClasses.find(c => c.id === selectedClassId);
  if (!selectedClass) {
    window.showToast?.('Selected class not found. Please refresh.', 'danger');
    return;
  }

  // Saves come from the working copy now, which covers every page the
  // teacher has touched, not just whichever page happens to be on screen
  const bufferEntries = Object.entries(resultsEditBuffer);

  if (bufferEntries.length === 0) {
    window.showToast?.('No scores have been entered', 'warning');
    return;
  }

  const maxMap = { assignment: 10, midterm: 20, project: 10, exam: 60 };
  let hasInvalidScores = false;
  const pupilResults = {};

  bufferEntries.forEach(([pupilId, scores]) => {
    const cleaned = { assignment: 0, midterm: 0, project: 0, exam: 0 };
    Object.keys(maxMap).forEach(field => {
      let value = parseFloat(scores[field]);
      if (isNaN(value)) value = 0;
      const max = maxMap[field];
      if (value > max) { value = max; hasInvalidScores = true; }
      if (value < 0)   { value = 0;   hasInvalidScores = true; }
      cleaned[field] = value;
    });
    pupilResults[pupilId] = cleaned;
  });

  if (hasInvalidScores) {
    Object.entries(pupilResults).forEach(([pupilId, scores]) => {
      resultsEditBuffer[pupilId] = scores;
    });
    saveResultsBufferToStorage();
    window.showToast?.('Some scores were out of range and have been corrected. Please review and save again.', 'warning', 5000);
    return;
  }

  let hasChanges = false;
  Object.values(pupilResults).forEach(scores => {
    if (scores.assignment || scores.midterm || scores.project || scores.exam) hasChanges = true;
  });
  if (!hasChanges) { window.showToast?.('No scores have been entered', 'warning'); return; }

  isSavingResults = true;

  const saveBtn = document.getElementById('save-results-btn');
  const originalHTML     = saveBtn?.innerHTML;
  const originalDisabled = saveBtn?.disabled;

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:.5rem;">
      <span style="width:14px;height:14px;border:2px solid transparent;border-top-color:currentColor;border-radius:50%;display:inline-block;animation:spin .8s linear infinite;"></span>
      Saving...</span>`;
  }

  try {
    const settings       = await window.getCurrentSettings();
    const currentSession = settings.session || 'Unknown';

    // Previously: a Firestore batch.set() straight to results_draft,
    // written from the browser with the teacher able to set any
    // field — including teacherId — on the document. Now: one POST
    // to the Worker, which recalculates caScore/examScore itself,
    // stamps teacherId from the verified ID token (never trusting
    // whatever the browser sends), and checks the roster + lock
    // state server-side before writing anything.
    const draftsPayload = Object.entries(pupilResults).map(([pupilId, scores]) => ({
      pupilId,
      classId: selectedClass.id,
      session: currentSession,
      term,
      subject,
      assignment: scores.assignment || 0,
      midterm:    scores.midterm    || 0,
      project:    scores.project    || 0,
      caScore:    (scores.assignment || 0) + (scores.midterm || 0) + (scores.project || 0),
      examScore:  scores.exam || 0,
    }));

    await teacherApiPost('/api/teacher/results/drafts', { results: draftsPayload });

    // Everything is now safely saved, so the local autosave is no
    // longer needed for this class/term/subject
    clearResultsBufferStorage();

    window.showToast?.(
      '✓ Results saved to your workspace\n\nℹ️ Not visible to pupils yet — submit for approval when ready.',
      'success', 6000
    );

  } catch (err) {
    console.error('Error saving results:', err);
    window.showToast?.(`Failed to save results: ${err.message || 'Unknown error'}`, 'danger', 6000);
  } finally {
    const finalSaveBtn = document.getElementById('save-results-btn');
    if (finalSaveBtn) {
      finalSaveBtn.disabled  = originalDisabled;
      finalSaveBtn.innerHTML = originalHTML;
      finalSaveBtn.style.opacity = '';
      finalSaveBtn.style.cursor  = '';
    }
    isSavingResults = false;
  }
}


/* ======================================== 
   ATTENDANCE 
======================================== */

async function loadAttendanceSection() {
  const container = document.getElementById('attendance-form-container');
  const saveBtn = document.getElementById('save-attendance-btn');
  const term = document.getElementById('attendance-term')?.value || 'First Term';

  if (!container || !saveBtn) return;

  if (assignedClasses.length === 0 || allPupils.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:var(--color-gray-600);">No pupils in assigned classes</p>';
    saveBtn.hidden = true;
    return;
  }

  try {
    const settings = await window.getCurrentSettings();
    const encodedSession = settings.session.replace(/\//g, '-');

    const attendanceMap = {};

    for (const pupil of allPupils) {
      const docId = `${pupil.id}_${encodedSession}_${term}`;
      const attendDoc = await db.collection('attendance').doc(docId).get();

      if (attendDoc.exists) {
        const data = attendDoc.data();
        attendanceMap[pupil.id] = {
          timesOpened: data.timesOpened || 0,
          timesPresent: data.timesPresent || 0,
          timesAbsent: data.timesAbsent || 0
        };
      }
    }

    container.innerHTML = `
      <div class="table-container">
        <table class="responsive-table" id="attendance-table">
          <thead>
            <tr>
              <th>Pupil Name</th>
              <th>Times School Opened</th>
              <th>Times Present</th>
              <th>Times Absent</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    `;

    paginateTable(allPupils, 'attendance-table', 25, (pupil, tbody) => {
      const existing = attendanceMap[pupil.id] || { timesOpened: 0, timesPresent: 0, timesAbsent: 0 };

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Pupil Name">${pupil.name}</td>
        <td data-label="Times School Opened">
          <input type="number" min="0" value="${existing.timesOpened || ''}"
                 data-pupil="${pupil.id}" data-field="timesOpened"
                 style="width:100%; max-width:100px;"
                 placeholder="0">
        </td>
        <td data-label="Times Present">
          <input type="number" min="0" value="${existing.timesPresent || ''}"
                 data-pupil="${pupil.id}" data-field="timesPresent"
                 style="width:100%; max-width:100px;"
                 placeholder="0">
        </td>
        <td data-label="Times Absent">
          <input type="number" min="0" value="${existing.timesAbsent || ''}"
                 data-pupil="${pupil.id}" data-field="timesAbsent"
                 style="width:100%; max-width:100px;"
                 placeholder="0">
        </td>
      `;
      tbody.appendChild(tr);
    });

    saveBtn.hidden = false;
  } catch (err) {
    console.error('Error loading attendance:', err);
    window.handleError?.(err, 'Failed to load attendance');
    container.innerHTML = '<p style="text-align:center; color:var(--color-danger);">Error loading attendance</p>';
    saveBtn.hidden = true;
  }
}

/* ======================================== 
   FIXED: Save Attendance with Session Context
======================================== */
/**
 * FIXED: Save Attendance with Validation
 * Ensures attendance data is logically valid before saving
 */
async function saveAllAttendance() {
  const inputs = document.querySelectorAll('#attendance-form-container input[type="number"]');
  const term = document.getElementById('attendance-term')?.value;

  if (!inputs.length || !term) {
    window.showToast?.('No data to save', 'warning');
    return;
  }

  // VALIDATION STEP 1: Collect and validate data
  const pupilData = {};
  const validationErrors = [];

  inputs.forEach(input => {
    const pupilId = input.dataset.pupil;
    const field = input.dataset.field;
    const value = parseInt(input.value) || 0;

    if (value < 0) {
      const pupilName = input.closest('tr')?.querySelector('td:first-child')?.textContent || 'Unknown';
      validationErrors.push(`${pupilName}: ${field} cannot be negative`);
      input.style.borderColor = '#dc3545';
      return;
    }

    if (!pupilData[pupilId]) pupilData[pupilId] = {};
    pupilData[pupilId][field] = value;
  });

  // VALIDATION STEP 2: Check logical consistency
  for (const [pupilId, data] of Object.entries(pupilData)) {
    const timesOpened = data.timesOpened || 0;
    const timesPresent = data.timesPresent || 0;
    const timesAbsent = data.timesAbsent || 0;

    const pupilRow = document.querySelector(`input[data-pupil="${pupilId}"]`)?.closest('tr');
    const pupilName = pupilRow?.querySelector('td:first-child')?.textContent || 'Unknown';

    if (timesPresent > timesOpened) {
      validationErrors.push(
        `${pupilName}: Times present (${timesPresent}) cannot exceed times school opened (${timesOpened})`
      );
      const presentInput = document.querySelector(`input[data-pupil="${pupilId}"][data-field="timesPresent"]`);
      if (presentInput) presentInput.style.borderColor = '#dc3545';
    }

    if (timesAbsent > timesOpened) {
      validationErrors.push(
        `${pupilName}: Times absent (${timesAbsent}) cannot exceed times school opened (${timesOpened})`
      );
      const absentInput = document.querySelector(`input[data-pupil="${pupilId}"][data-field="timesAbsent"]`);
      if (absentInput) absentInput.style.borderColor = '#dc3545';
    }

    if (timesPresent + timesAbsent > timesOpened) {
      validationErrors.push(
        `${pupilName}: Total attendance (${timesPresent} present + ${timesAbsent} absent = ${timesPresent + timesAbsent}) ` +
        `cannot exceed times school opened (${timesOpened})`
      );
    }
  }

  if (validationErrors.length > 0) {
    const errorMessage =
      `⚠️ ATTENDANCE VALIDATION ERRORS (${validationErrors.length}):\n\n` +
      validationErrors.slice(0, 5).join('\n') +
      (validationErrors.length > 5 ? `\n... and ${validationErrors.length - 5} more errors` : '');

    alert(errorMessage);
    window.showToast?.(
      `Cannot save: ${validationErrors.length} validation error(s) found. Please fix highlighted fields.`,
      'danger',
      8000
    );
    return;
  }

  // Clear any previous error highlighting
  inputs.forEach(input => { input.style.borderColor = ''; });

  // SAVE: Get current session — encode it for the document ID
  const settings = await window.getCurrentSettings();
  const currentSession = settings.session || 'Unknown';
  const encodedSession = currentSession.replace(/\//g, '-');
  const sessionStartYear = settings.currentSession?.startYear;
  const sessionEndYear = settings.currentSession?.endYear;
  const sessionTerm = `${currentSession}_${term}`;

  const batch = db.batch();

  for (const [pupilId, data] of Object.entries(pupilData)) {
    // FIX: Document ID now includes encodedSession so each year is a separate record
    const ref = db.collection('attendance').doc(`${pupilId}_${encodedSession}_${term}`);
    batch.set(ref, {
      pupilId,
      term,
      teacherId: currentUser.uid,
      session: currentSession,
      sessionStartYear: sessionStartYear,
      sessionEndYear: sessionEndYear,
      sessionTerm: sessionTerm,
      ...data,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  try {
    await batch.commit();
    window.showToast?.('✓ Attendance saved successfully', 'success');
  } catch (err) {
    console.error('Error saving attendance:', err);
    window.handleError?.(err, 'Failed to save attendance');
  }
}

/* ======================================== 
   TRAITS & SKILLS 
======================================== */

/**
 * Load traits section - now with bulk entry
 */
function loadTraitsSection() {
    const termSelect = document.getElementById('traits-term');
    
    if (!termSelect) return;
    
    // Auto-load bulk table
    loadBulkTraitsTable();
}

/**
 * REPLACEMENT for loadBulkTraitsTable() in teacher.js
 *
 * Changes vs original:
 * - Generates sibling .tp-traits-mobile-cards divs alongside each table
 * - Mobile sees the card layout; desktop sees the table (toggled via CSS)
 * - All selects share the same data-pupil / data-field / data-type attributes
 *   so saveBulkTraitsAndSkills() still works unchanged.
 */
async function loadBulkTraitsTable() {
  const container = document.getElementById('traits-form-container');
  const term = document.getElementById('traits-term')?.value;

  if (!container || !term) return;

  if (allPupils.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:var(--color-gray-600); padding: var(--space-2xl);">No pupils in your assigned classes</p>';
    return;
  }

  container.innerHTML = `
    <div style="text-align:center; padding: var(--space-2xl);">
      <div class="spinner" style="margin: 0 auto var(--space-md);"></div>
      <p style="color: var(--color-gray-600);">Loading traits data...</p>
    </div>
  `;

  try {
    const settings = await window.getCurrentSettings();
    const encodedSession = settings.session.replace(/\//g, '-');

    const traitsData = {};
    const skillsData = {};

    for (const pupil of allPupils) {
      const traitsDocId = `${pupil.id}_${encodedSession}_${term}`;
      const traitsDoc = await db.collection('behavioral_traits').doc(traitsDocId).get();
      if (traitsDoc.exists) traitsData[pupil.id] = traitsDoc.data();

      const skillsDoc = await db.collection('psychomotor_skills').doc(traitsDocId).get();
      if (skillsDoc.exists) skillsData[pupil.id] = skillsDoc.data();
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    const traitsFields = [
      { key: 'punctuality',    label: 'Punctuality' },
      { key: 'neatness',       label: 'Neatness' },
      { key: 'politeness',     label: 'Politeness' },
      { key: 'honesty',        label: 'Honesty' },
      { key: 'obedience',      label: 'Obedience' },
      { key: 'cooperation',    label: 'Cooperation' },
      { key: 'attentiveness',  label: 'Attentiveness' },
      { key: 'leadership',     label: 'Leadership' },
      { key: 'selfcontrol',    label: 'Self Control' },
      { key: 'creativity',     label: 'Creativity' },
    ];

    const skillsFields = [
      { key: 'handwriting', label: 'Handwriting' },
      { key: 'drawing',     label: 'Drawing' },
      { key: 'sports',      label: 'Sports' },
      { key: 'craft',       label: 'Craft' },
      { key: 'verbal',      label: 'Verbal' },
      { key: 'coordination',label: 'Coordination' },
    ];

    /** Build <select> HTML — shared between table cells and mobile cards */
    function selectHTML(pupilId, field, type, existingData) {
      const value = existingData[field] || '';
      return `
        <select data-pupil="${pupilId}" data-field="${field}" data-type="${type}">
          <option value="">-</option>
          ${[1,2,3,4,5].map(n => `<option value="${n}" ${value == n ? 'selected' : ''}>${n}</option>`).join('')}
        </select>`;
    }

    /** Build a mobile card block for one group (traits OR skills) */
    function buildMobileCards(fields, dataMap, type) {
      return allPupils.map(pupil => {
        const existing = dataMap[pupil.id] || {};
        const fieldCells = fields.map(f => `
          <div class="tp-traits-field">
            <span class="tp-traits-field-label">${f.label}</span>
            ${selectHTML(pupil.id, f.key, type, existing)}
          </div>`).join('');

        return `
          <div class="tp-traits-pupil-card">
            <div class="tp-traits-pupil-name">${pupil.name}</div>
            <div class="tp-traits-fields">${fieldCells}</div>
          </div>`;
      }).join('');
    }

    /** Build a desktop <table> for one group */
    function buildDesktopTable(id, fields, dataMap, type) {
      const headerCells = fields.map(f => `<th>${f.label}</th>`).join('');
      const bodyRows = allPupils.map(pupil => {
        const existing = dataMap[pupil.id] || {};
        const cells = fields.map(f => `
          <td data-label="${f.label}" style="text-align:center;">
            ${selectHTML(pupil.id, f.key, type, existing)}
          </td>`).join('');
        return `
          <tr>
            <td data-label="Name"><strong>${pupil.name}</strong></td>
            ${cells}
          </tr>`;
      }).join('');

      return `
        <div class="table-container">
          <table class="responsive-table" id="${id}">
            <thead>
              <tr>
                <th style="min-width:130px;">Pupil Name</th>
                ${headerCells}
              </tr>
            </thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </div>`;
    }

    // ── Render ───────────────────────────────────────────────────────────────

    container.innerHTML = `
      <div style="margin-bottom: var(--tp-space-5); padding: var(--tp-space-4) var(--tp-space-5);
                  background: #e0f2fe; border: 1px solid #0284c7;
                  border-radius: var(--tp-radius-md);">
        <strong style="color:#0c4a6e;">📊 Bulk Entry Mode</strong>
        <p style="margin:.5rem 0 0; color:#075985; font-size:var(--text-sm);">
          Rate each trait/skill from 1 (Poor) to 5 (Excellent). Leave blank if not assessed.
        </p>
      </div>

      <!-- ── BEHAVIORAL TRAITS ── -->
      <div style="margin-bottom: var(--tp-space-8);">
        <h3 style="margin-bottom: var(--tp-space-4);">Behavioral Traits</h3>

        <!-- Desktop table (hidden on mobile via CSS) -->
        ${buildDesktopTable('bulk-traits-table', traitsFields, traitsData, 'trait')}

        <!-- Mobile cards (hidden on desktop via CSS) -->
        <div class="tp-traits-mobile-cards" id="mobile-traits-cards">
          ${buildMobileCards(traitsFields, traitsData, 'trait')}
        </div>
      </div>

      <!-- ── PSYCHOMOTOR SKILLS ── -->
      <div style="margin-bottom: var(--tp-space-6);">
        <h3 style="margin-bottom: var(--tp-space-4);">Psychomotor Skills</h3>

        <!-- Desktop table (hidden on mobile via CSS) -->
        ${buildDesktopTable('bulk-skills-table', skillsFields, skillsData, 'skill')}

        <!-- Mobile cards (hidden on desktop via CSS) -->
        <div class="tp-traits-mobile-cards" id="mobile-skills-cards">
          ${buildMobileCards(skillsFields, skillsData, 'skill')}
        </div>
      </div>

      <button class="btn btn-primary" onclick="saveBulkTraitsAndSkills()"
              style="width:100%; margin-top: var(--tp-space-4);">
        💾 Save All Traits &amp; Skills
      </button>
    `;

    // Hide mobile cards on desktop, hide tables on mobile — done via CSS.
    // But we also do it with JS as a fallback for browsers that don't
    // support the CSS selectors cleanly.
    function applyVisibility() {
      const isMobile = window.innerWidth <= 640;
      ['bulk-traits-table', 'bulk-skills-table'].forEach(id => {
        const el = document.getElementById(id)?.closest('.table-container');
        if (el) el.style.display = isMobile ? 'none' : '';
      });
      ['mobile-traits-cards', 'mobile-skills-cards'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = isMobile ? 'flex' : 'none';
      });
    }

    applyVisibility();
    window.addEventListener('resize', applyVisibility);

    console.log(`✓ Bulk traits table loaded for ${allPupils.length} pupils`);

  } catch (error) {
    console.error('Error loading bulk traits table:', error);
    container.innerHTML = '<p style="text-align:center; color:var(--color-danger); padding: var(--space-2xl);">Error loading traits data</p>';
  }
}

/**
 * Save all traits and skills in bulk
 */
async function saveBulkTraitsAndSkills() {
  const term = document.getElementById('traits-term')?.value;

  if (!term) {
    window.showToast?.('Select a term first', 'warning');
    return;
  }

  const selects = document.querySelectorAll('#traits-form-container select');

  if (selects.length === 0) {
    window.showToast?.('No data to save', 'warning');
    return;
  }

  const traitsByPupil = {};
  const skillsByPupil = {};

  selects.forEach(select => {
    const pupilId = select.dataset.pupil;
    const field = select.dataset.field;
    const type = select.dataset.type;
    const value = select.value;

    // BUG 5 FIX: Skip blank values entirely — do not overwrite a saved score with ""
    if (value === '') return;

    if (type === 'trait') {
      if (!traitsByPupil[pupilId]) {
        traitsByPupil[pupilId] = { pupilId, term, teacherId: currentUser.uid };
      }
      traitsByPupil[pupilId][field] = value;
    } else if (type === 'skill') {
      if (!skillsByPupil[pupilId]) {
        skillsByPupil[pupilId] = { pupilId, term, teacherId: currentUser.uid };
      }
      skillsByPupil[pupilId][field] = value;
    }
  });

  // Get session context
  const settings = await window.getCurrentSettings();
  const session = settings.session;
  // BUG 1 FIX: Encode session for document ID
  const encodedSession = session.replace(/\//g, '-');
  const sessionStartYear = settings.currentSession?.startYear;
  const sessionEndYear = settings.currentSession?.endYear;
  const sessionTerm = `${session}_${term}`;

  const batch = db.batch();
  let operationCount = 0;

  for (const [pupilId, data] of Object.entries(traitsByPupil)) {
    // BUG 1 FIX: Document ID now includes encodedSession
    const ref = db.collection('behavioral_traits').doc(`${pupilId}_${encodedSession}_${term}`);
    batch.set(ref, {
      ...data,
      session,
      sessionStartYear,
      sessionEndYear,
      sessionTerm,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    operationCount++;
  }

  for (const [pupilId, data] of Object.entries(skillsByPupil)) {
    // BUG 1 FIX: Document ID now includes encodedSession
    const ref = db.collection('psychomotor_skills').doc(`${pupilId}_${encodedSession}_${term}`);
    batch.set(ref, {
      ...data,
      session,
      sessionStartYear,
      sessionEndYear,
      sessionTerm,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    operationCount++;
  }

  if (operationCount === 0) {
    window.showToast?.('No changes to save', 'info');
    return;
  }

  try {
    await batch.commit();
    window.showToast?.(
      `✓ Saved traits & skills for ${Object.keys(traitsByPupil).length} pupil(s)`,
      'success'
    );
  } catch (error) {
    console.error('Error saving bulk traits:', error);
    window.handleError(error, 'Failed to save traits & skills');
  }
}

// Make functions globally available
window.loadBulkTraitsTable = loadBulkTraitsTable;
window.saveBulkTraitsAndSkills = saveBulkTraitsAndSkills;

/* ======================================== 
   REMARKS 
======================================== */

function loadRemarksSection() {
  const pupilSelect = document.getElementById('remarks-pupil');
  const container = document.getElementById('remarks-form-container');
  
  if (!pupilSelect || !container) return;
  
  pupilSelect.innerHTML = '<option value="">-- Select Pupil --</option>';
  
  if (allPupils.length === 0) {
    container.hidden = true;
    return;
  }
  
  allPupils.forEach(pupil => {
    const opt = document.createElement('option');
    opt.value = pupil.id;
    opt.textContent = pupil.name;
    pupilSelect.appendChild(opt);
  });
  
  container.hidden = true;
}

async function loadRemarksData() {
  const pupilId   = document.getElementById('remarks-pupil')?.value;
  const term      = document.getElementById('remarks-term')?.value;
  const container = document.getElementById('remarks-form-container');

  if (!container || !pupilId || !term) {
    if (container) container.hidden = true;
    return;
  }

  try {
    const settings        = await window.getCurrentSettings();
    const encodedSession  = settings.session.replace(/\//g, '-');

    const docSnap = await db.collection('remarks')
      .doc(`${pupilId}_${encodedSession}_${term}`).get();
    const data = docSnap.exists ? docSnap.data() : {};

    document.getElementById('teacher-remark').value = data.teacherRemark || '';
    document.getElementById('head-remark').value    = data.headRemark    || '';

    container.hidden = false;
  } catch (err) {
    window.handleError(err, 'Failed to load remarks');
    container.hidden = true;
  }

  await loadRemarkSuggestions();
  await loadHeadRemarkSuggestions();
}

/**
 * Load remark suggestions based on pupil's performance
 */
async function loadRemarkSuggestions() {
  const pupilId        = document.getElementById('remarks-pupil')?.value;
  const term           = document.getElementById('remarks-term')?.value;
  const suggestionsDiv = document.getElementById('remark-suggestions');
  const infoDiv        = document.getElementById('suggestion-info');
  const buttonsDiv     = document.getElementById('suggestion-buttons');

  if (!pupilId || !term || !suggestionsDiv) {
    if (suggestionsDiv) suggestionsDiv.style.display = 'none';
    return;
  }

  suggestionsDiv.style.display = 'block';
  infoDiv.innerHTML    = '<span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;"></span> Loading suggestions...';
  buttonsDiv.innerHTML = '';

  try {
    const result = await window.remarkTemplates.getRemarkSuggestions(pupilId, term);

    if (!result.success) {
      infoDiv.innerHTML    = `<span style="color:var(--color-warning);">⚠️ ${result.message}</span>`;
      buttonsDiv.innerHTML = '';
      return;
    }

    const categoryLabels = {
      excellent: '🌟 Excellent',
      veryGood:  '✨ Very Good',
      good:      '👍 Good',
      average:   '📊 Average',
      poor:      '⚠️ Needs Improvement'
    };

    infoDiv.innerHTML = `
      Average: <strong>${result.average}%</strong> &bull;
      Category: <strong style="color:var(--color-primary);">
        ${categoryLabels[result.category] || result.category}
      </strong>
    `;

    if (result.templates.length === 0) {
      buttonsDiv.innerHTML = '<p style="color:var(--color-gray-600);margin:0;">No templates available</p>';
      return;
    }

    buttonsDiv.innerHTML = '';
    result.templates.forEach(template => {
      const btn         = document.createElement('button');
      btn.type          = 'button';
      btn.className     = 'btn-small btn-secondary';
      btn.style.cssText = 'text-align:left;white-space:normal;max-width:100%;';
      btn.textContent   = template;
      btn.onclick       = () => useRemarkTemplate(template);
      buttonsDiv.appendChild(btn);
    });

  } catch (error) {
    console.error('Error loading suggestions:', error);
    infoDiv.innerHTML    = '<span style="color:var(--color-danger);">❌ Failed to load suggestions</span>';
    buttonsDiv.innerHTML = '';
  }
}

async function loadHeadRemarkSuggestions() {
  const pupilId         = document.getElementById('remarks-pupil')?.value;
  const term            = document.getElementById('remarks-term')?.value;
  const suggestionsDiv  = document.getElementById('head-remark-suggestions');
  const infoDiv         = document.getElementById('head-suggestion-info');
  const buttonsDiv      = document.getElementById('head-suggestion-buttons');
  const headRemarkField = document.getElementById('head-remark');

  if (!pupilId || !term || !suggestionsDiv) {
    if (suggestionsDiv) suggestionsDiv.style.display = 'none';
    return;
  }

  suggestionsDiv.style.display = 'block';
  infoDiv.innerHTML    = '<span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;"></span> Loading suggestions...';
  buttonsDiv.innerHTML = '';

  try {
    const result = await window.remarkTemplates.getHeadRemarkSuggestions(pupilId, term);

    if (!result.success) {
      infoDiv.innerHTML    = `<span style="color:var(--color-warning);">⚠️ ${result.message}</span>`;
      buttonsDiv.innerHTML = '';
      return;
    }

    const categoryLabels = {
      excellent: '🌟 Excellent',
      veryGood:  '✨ Very Good',
      good:      '👍 Good',
      average:   '📊 Average',
      poor:      '⚠️ Needs Improvement'
    };

    infoDiv.innerHTML = `
      Average: <strong>${result.average}%</strong> &bull;
      Category: <strong style="color:var(--color-primary);">
        ${categoryLabels[result.category] || result.category}
      </strong>
      <span style="margin-left:8px;font-size:0.8em;color:var(--color-gray-500);">(auto-filled below)</span>
    `;

    if (headRemarkField && !headRemarkField.value.trim() && result.autoSelected) {
      headRemarkField.value = result.autoSelected;
    }

    if (result.templates.length === 0) {
      buttonsDiv.innerHTML = '<p style="color:var(--color-gray-600);margin:0;">No templates available</p>';
      return;
    }

    buttonsDiv.innerHTML = '';
    result.templates.forEach(template => {
      const btn         = document.createElement('button');
      btn.type          = 'button';
      btn.className     = 'btn-small btn-secondary';
      btn.style.cssText = 'text-align:left;white-space:normal;max-width:100%;';
      btn.textContent   = template;
      btn.onclick       = () => useHeadRemarkTemplate(template);
      buttonsDiv.appendChild(btn);
    });

  } catch (error) {
    console.error('Error loading head remark suggestions:', error);
    infoDiv.innerHTML    = '<span style="color:var(--color-danger);">❌ Failed to load suggestions</span>';
    buttonsDiv.innerHTML = '';
  }
}

/**
 * Use selected remark template
 */
function useRemarkTemplate(template) {
  const remarkTextarea = document.getElementById('teacher-remark');
  if (!remarkTextarea) return;
  remarkTextarea.value = template;
  remarkTextarea.focus();
  window.showToast?.('Template applied. You can edit it before saving.', 'success', 3000);
}

function useHeadRemarkTemplate(template) {
  const headRemarkTextarea = document.getElementById('head-remark');
  if (!headRemarkTextarea) return;
  headRemarkTextarea.value = template;
  headRemarkTextarea.focus();
  window.showToast?.('Head teacher template applied. You can edit it before saving.', 'success', 3000);
}

/**
 * Refresh remark suggestions
 */
async function refreshRemarkSuggestions() {
  await loadRemarkSuggestions();
  await loadHeadRemarkSuggestions();
}

// Make functions globally available
window.loadRemarkSuggestions     = loadRemarkSuggestions;
window.loadHeadRemarkSuggestions = loadHeadRemarkSuggestions;
window.useRemarkTemplate         = useRemarkTemplate;
window.useHeadRemarkTemplate     = useHeadRemarkTemplate;
window.refreshRemarkSuggestions  = refreshRemarkSuggestions;

async function saveRemarks() {
  const pupilId = document.getElementById('remarks-pupil')?.value;
  const term = document.getElementById('remarks-term')?.value;
  const teacherRemark = document.getElementById('teacher-remark')?.value.trim();
  const headRemark = document.getElementById('head-remark')?.value.trim();

  if (!pupilId || !term) {
    window.showToast?.('Select pupil and term', 'warning');
    return;
  }

  if (!teacherRemark && !headRemark) {
    window.showToast?.('Enter at least one remark', 'warning');
    return;
  }

  const settings = await window.getCurrentSettings();
  const currentSession = settings.session || 'Unknown';
  // BUG 1 FIX: Encode session for document ID
  const encodedSession = currentSession.replace(/\//g, '-');
  const sessionStartYear = settings.currentSession?.startYear;
  const sessionEndYear = settings.currentSession?.endYear;
  const sessionTerm = `${currentSession}_${term}`;

  const data = {
    pupilId,
    term,
    teacherId: currentUser.uid,
    teacherRemark,
    headRemark,
    session: currentSession,
    sessionStartYear: sessionStartYear,
    sessionEndYear: sessionEndYear,
    sessionTerm: sessionTerm,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    // BUG 1 FIX: Document ID now includes encodedSession
    await db.collection('remarks').doc(`${pupilId}_${encodedSession}_${term}`).set(data, { merge: true });
    window.showToast?.('✓ Remarks saved successfully', 'success');
  } catch (err) {
    console.error('Error saving remarks:', err);
    window.handleError?.(err, 'Failed to save remarks');
  }
}

/* ======================================== 
   CLASS PROMOTION
======================================== */

let promotionData = {
  currentClassName: null,
  nextClassName: null,
  isTerminalClass: false,
  promotionPeriodActive: false
};

async function loadPromotionSection() {
  try {
    // Check if promotion period is active
    const settings = await window.getCurrentSettings();
    promotionData.promotionPeriodActive = settings.promotionPeriodActive || false;
    
    const statusBanner = document.getElementById('promotion-status-banner');
    const disabledBanner = document.getElementById('promotion-disabled-banner');
    const controls = document.getElementById('promotion-controls');
    const tableContainer = document.getElementById('promotion-table-container');
    
    if (promotionData.promotionPeriodActive) {
      if (statusBanner) statusBanner.style.display = 'flex';
      if (disabledBanner) disabledBanner.style.display = 'none';
    } else {
      if (statusBanner) statusBanner.style.display = 'none';
      if (disabledBanner) disabledBanner.style.display = 'flex';
      if (controls) controls.style.display = 'none';
      if (tableContainer) tableContainer.style.display = 'none';
      return;
    }
    
    // Check if teacher has assigned classes
    if (assignedClasses.length === 0) {
      document.getElementById('no-class-message').style.display = 'block';
      if (controls) controls.style.display = 'none';
      if (tableContainer) tableContainer.style.display = 'none';
      return;
    } else {
      document.getElementById('no-class-message').style.display = 'none';
    }
    
    // Get first assigned class (teacher should only have one for promotion)
    const currentClass = assignedClasses[0];
    promotionData.currentClassName = currentClass.name;
    
    // Display current class
    document.getElementById('promotion-current-class').textContent = currentClass.name;
    
    // Get next class in hierarchy
    const nextClass = await window.classHierarchy.getNextClass(currentClass.name);
    promotionData.nextClassName = nextClass;
    
    // Check if terminal class
    promotionData.isTerminalClass = await window.classHierarchy.isTerminalClass(currentClass.name);
    
    if (promotionData.isTerminalClass) {
      document.getElementById('promotion-next-class').textContent = 'Graduation (Alumni)';
      document.getElementById('terminal-class-message').style.display = 'block';
    } else if (nextClass) {
      document.getElementById('promotion-next-class').textContent = nextClass;
      document.getElementById('terminal-class-message').style.display = 'none';
    } else {
      document.getElementById('promotion-next-class').textContent = 'Not defined';
      window.showToast?.('Next class not found in hierarchy. Contact admin.', 'warning', 6000);
      if (controls) controls.style.display = 'none';
      if (tableContainer) tableContainer.style.display = 'none';
      return;
    }
    
    // Load pupils with performance data
    await loadPromotionPupils();
    
    // Show controls and table
    if (controls) controls.style.display = 'flex';
    if (tableContainer) tableContainer.style.display = 'block';
    
  } catch (error) {
    console.error('Error loading promotion section:', error);
    window.showToast?.('Failed to load promotion section', 'danger');
  }
}

async function loadPromotionPupils() {
  const tbody = document.getElementById('promotion-pupils-table');
  if (!tbody || allPupils.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--color-gray-600);">No pupils in your class</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="5" class="table-loading">Loading pupils and calculating averages...</td></tr>';

  try {
    const settings = await window.getCurrentSettings();
    const currentTerm = settings.term;
    // BUG 4 FIX: Also capture the current session to pass to calculatePupilAverage
    const currentSession = settings.session;

    const pupilsWithScores = await Promise.all(
      allPupils.map(async pupil => {
        // BUG 4 FIX: Pass currentSession so only this year's results are used
        const average = await calculatePupilAverage(pupil.id, currentTerm, currentSession);
        return {
          ...pupil,
          average: average.average,
          grade: average.grade
        };
      })
    );

    pupilsWithScores.sort((a, b) => b.average - a.average);

    tbody.innerHTML = '';

    pupilsWithScores.forEach(pupil => {
      const tr = document.createElement('tr');
      const avgDisplay = pupil.average > 0 ? `${pupil.average.toFixed(1)}%` : 'No results';
      const gradeClass = pupil.grade ? `grade-${pupil.grade}` : '';

      tr.innerHTML = `
        <td style="text-align:center;">
          <input type="checkbox"
                 class="pupil-promote-checkbox"
                 data-pupil-id="${pupil.id}"
                 data-pupil-name="${pupil.name}"
                 ${pupil.average >= 40 ? 'checked' : ''}>
        </td>
        <td data-label="Name"><strong>${pupil.name}</strong></td>
        <td data-label="Average" style="text-align:center;">${avgDisplay}</td>
        <td data-label="Grade" style="text-align:center;" class="${gradeClass}">${pupil.grade || '-'}</td>
        <td data-label="Status" style="text-align:center;">
          <span class="status-badge ${pupil.average >= 40 ? 'status-promote' : 'status-hold'}">
            ${pupil.average >= 40 ? 'Promote' : 'Review'}
          </span>
        </td>
      `;
      tbody.appendChild(tr);
    });

    updateSelectAllCheckbox();

  } catch (error) {
    console.error('Error loading promotion pupils:', error);
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--color-danger);">Error loading pupils</td></tr>';
  }
}

// BUG 4 FIX: Added `session` parameter — only returns results from the current school year
async function calculatePupilAverage(pupilId, term, session) {
  try {
    let resultsSnap;

    if (session) {
      // With session: only this year's approved results for this term
      resultsSnap = await db.collection('results')
        .where('pupilId', '==', pupilId)
        .where('term', '==', term)
        .where('session', '==', session)
        .get();
    } else {
      // Fallback if session not provided (original behaviour — kept for safety)
      resultsSnap = await db.collection('results')
        .where('pupilId', '==', pupilId)
        .where('term', '==', term)
        .get();
    }

    if (resultsSnap.empty) {
      return { average: 0, grade: null };
    }

    let totalScore = 0;
    let subjectCount = 0;

    resultsSnap.forEach(doc => {
      const data = doc.data();
      const ca = parseFloat(data.caScore) || 0;
      const exam = parseFloat(data.examScore) || 0;
      const score = ca + exam;

      totalScore += score;
      subjectCount++;
    });

    const average = subjectCount > 0 ? Math.round((totalScore / subjectCount) * 10) / 10 : 0;
    const grade = getGradeFromScore(average);

    return { average, grade };

  } catch (error) {
    console.error('Error calculating average for pupil:', pupilId, error);
    return { average: 0, grade: null };
  }
}

function getGradeFromScore(score) {
  if (score >= 75) return 'A1';
  if (score >= 70) return 'B2';
  if (score >= 65) return 'B3';
  if (score >= 60) return 'C4';
  if (score >= 55) return 'C5';
  if (score >= 50) return 'C6';
  if (score >= 45) return 'D7';
  if (score >= 40) return 'D8';
  return 'F9';
}

function selectAllForPromotion() {
  document.querySelectorAll('.pupil-promote-checkbox').forEach(checkbox => {
    checkbox.checked = true;
  });
  updateSelectAllCheckbox();
}

function deselectAllForPromotion() {
  document.querySelectorAll('.pupil-promote-checkbox').forEach(checkbox => {
    checkbox.checked = false;
  });
  updateSelectAllCheckbox();
}

function toggleAllPupilsPromotion(masterCheckbox) {
  const isChecked = masterCheckbox.checked;
  document.querySelectorAll('.pupil-promote-checkbox').forEach(checkbox => {
    checkbox.checked = isChecked;
  });
}

function updateSelectAllCheckbox() {
  const allCheckboxes = document.querySelectorAll('.pupil-promote-checkbox');
  const checkedBoxes = document.querySelectorAll('.pupil-promote-checkbox:checked');
  const selectAllCheckbox = document.getElementById('select-all-pupils-promo');
  
  if (selectAllCheckbox && allCheckboxes.length > 0) {
    selectAllCheckbox.checked = allCheckboxes.length === checkedBoxes.length;
    selectAllCheckbox.indeterminate = checkedBoxes.length > 0 && checkedBoxes.length < allCheckboxes.length;
  }
}

// Listen to individual checkbox changes
document.addEventListener('change', (e) => {
  if (e.target.classList.contains('pupil-promote-checkbox')) {
    updateSelectAllCheckbox();
  }
});

async function submitPromotionRequest() {
  if (!promotionData.currentClassName) {
    window.showToast?.('Promotion data not loaded. Please refresh the page.', 'danger');
    return;
  }

  if (!promotionData.isTerminalClass && !promotionData.nextClassName) {
    window.showToast?.('Next class not found in hierarchy. Contact admin.', 'danger');
    return;
  }

  const checkboxes = document.querySelectorAll('.pupil-promote-checkbox:checked');
  const promotedPupils = Array.from(checkboxes).map(cb => ({
    id: cb.dataset.pupilId,
    name: cb.dataset.pupilName
  }));

  const allCheckboxes = document.querySelectorAll('.pupil-promote-checkbox');
  const heldBackPupils = Array.from(allCheckboxes)
    .filter(cb => !cb.checked)
    .map(cb => ({
      id: cb.dataset.pupilId,
      name: cb.dataset.pupilName
    }));

  if (promotedPupils.length === 0) {
    if (!confirm('No pupils selected for promotion. This means all pupils will be held back. Continue?')) {
      return;
    }
  }

  const destinationText = promotionData.isTerminalClass
    ? 'Alumni (Graduation)'
    : promotionData.nextClassName;

  const confirmation = confirm(
    `Submit Promotion Request?\n\n` +
    `✓ Promote: ${promotedPupils.length} pupil(s) to ${destinationText}\n` +
    `✗ Hold back: ${heldBackPupils.length} pupil(s) in ${promotionData.currentClassName}\n\n` +
    `This request will be sent to the admin for approval.`
  );

  if (!confirmation) return;

  const submitBtn = document.getElementById('submit-promotion-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="btn-loading">Submitting...</span>';
  }

  try {
    const settings = await window.getCurrentSettings();
    const currentSession = settings.session;

    let toClassId = null;
    if (!promotionData.isTerminalClass) {
      const classesSnap = await db.collection('classes')
        .where('name', '==', promotionData.nextClassName)
        .limit(1)
        .get();

      if (!classesSnap.empty) {
        toClassId = classesSnap.docs[0].id;
      } else {
        window.showToast?.('Next class not found in database. Contact admin.', 'danger');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '📋 Submit Promotion List';
        }
        return;
      }
    }

    const promotionRequest = {
      fromSession: currentSession,
      fromClass: {
        id: assignedClasses[0].id,
        name: promotionData.currentClassName
      },
      toClass: promotionData.isTerminalClass
        ? { id: 'alumni', name: 'Alumni' }
        : { id: toClassId, name: promotionData.nextClassName },
      isTerminalClass: promotionData.isTerminalClass,
      promotedPupils: promotedPupils.map(p => p.id),
      promotedPupilsDetails: promotedPupils,
      heldBackPupils: heldBackPupils.map(p => p.id),
      heldBackPupilsDetails: heldBackPupils,
      initiatedBy: currentUser.uid,
      status: 'pending',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    // BUG 6 FIX: Check if a promotion request already exists for this class and session.
    // If one exists, update it. If not, create a new one.
    const existingSnap = await db.collection('promotions')
      .where('fromClass.id', '==', assignedClasses[0].id)
      .where('fromSession', '==', currentSession)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      // Update the existing pending request instead of creating a duplicate
      await db.collection('promotions').doc(existingSnap.docs[0].id).set(promotionRequest, { merge: true });
      console.log('✅ Existing promotion request updated:', existingSnap.docs[0].id);
    } else {
      // No existing request — create a new one
      promotionRequest.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('promotions').add(promotionRequest);
      console.log('✅ New promotion request created');
    }

    console.log('✅ Promotion request submitted:', {
      type: promotionData.isTerminalClass ? 'Terminal → Alumni' : 'Regular',
      from: promotionData.currentClassName,
      to: destinationText,
      promoted: promotedPupils.length,
      heldBack: heldBackPupils.length
    });

    window.showToast?.(
      '✓ Promotion request submitted successfully!\nAdmin will review and approve your recommendations.',
      'success',
      8000
    );

    await loadPromotionSection();

  } catch (error) {
    console.error('Error submitting promotion request:', error);
    window.handleError(error, 'Failed to submit promotion request');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '📋 Submit Promotion List';
    }
  }
}

// Make functions globally available
window.selectAllForPromotion = selectAllForPromotion;
window.deselectAllForPromotion = deselectAllForPromotion;
window.toggleAllPupilsPromotion = toggleAllPupilsPromotion;
window.submitPromotionRequest = submitPromotionRequest;

// Export all functions used by HTML
window.loadResultsTable = loadResultsTable;
window.saveAllResults = saveAllResults;
window.saveAllAttendance = saveAllAttendance;
window.loadRemarksData = loadRemarksData;
window.saveRemarks = saveRemarks;
window.loadAttendanceSection = loadAttendanceSection;
window.paginateTable = paginateTable; // ← EXPOSE FOR ATTENDANCE UI

// Helper for manual attendance save (used by attendance-teacher-ui.js)
window._saveAttendanceFromInputs = async function(inputs, term) {
  if (!inputs.length || !term) {
    window.showToast?.('No data to save', 'warning');
    return;
  }

  const pupilData = {};
  const validationErrors = [];

  inputs.forEach(input => {
    const pupilId = input.dataset.pupil;
    const field   = input.dataset.field;
    const value   = parseInt(input.value) || 0;
    if (value < 0) { validationErrors.push(`Negative value for ${field}`); return; }
    if (!pupilData[pupilId]) pupilData[pupilId] = {};
    pupilData[pupilId][field] = value;
  });

  for (const [pupilId, data] of Object.entries(pupilData)) {
    const { timesOpened = 0, timesPresent = 0, timesAbsent = 0 } = data;
    if (timesPresent > timesOpened) validationErrors.push(`Pupil ${pupilId}: Present > Opened`);
    if (timesAbsent  > timesOpened) validationErrors.push(`Pupil ${pupilId}: Absent > Opened`);
    if (timesPresent + timesAbsent > timesOpened) validationErrors.push(`Pupil ${pupilId}: Present+Absent > Opened`);
  }

  if (validationErrors.length > 0) {
    window.showToast?.(`Validation errors: ${validationErrors[0]}`, 'danger', 6000);
    return;
  }

  const settings = await window.getCurrentSettings();
  const currentSession = settings.session || 'Unknown';
  const encodedSession = currentSession.replace(/\//g, '-'); // ✅ FIXED: was missing this
  const batch = db.batch();

  for (const [pupilId, data] of Object.entries(pupilData)) {
    // ✅ FIX: doc ID now includes encodedSession (consistent with saveAllAttendance)
    const ref = db.collection('attendance').doc(`${pupilId}_${encodedSession}_${term}`);
    batch.set(ref, {
      pupilId, term,
      teacherId: currentUser.uid,
      session: currentSession,
      sessionTerm: `${currentSession}_${term}`,
      ...data,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  try {
    await batch.commit();
    window.showToast?.('✓ Manual attendance totals saved', 'success');
  } catch (err) {
    window.handleError?.(err, 'Failed to save attendance');
  }
};

console.log('✓ Teacher portal v8.1.0 loaded - RACE CONDITIONS FIXED');
