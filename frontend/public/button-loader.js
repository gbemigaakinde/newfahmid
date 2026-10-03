/**
 * FAHMID NURSERY & PRIMARY SCHOOL
 * Global Button Loading State Manager — button-loader.js
 * @version 2.1.0
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   DESIGN TOKENS — match teacher-ui.css
═══════════════════════════════════════════════════════════════ */
const BL_STYLES = `
@keyframes bl-spin { to { transform: rotate(360deg); } }

.bl-spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255,255,255,0.35);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: bl-spin 0.7s linear infinite;
    flex-shrink: 0;
    vertical-align: middle;
}

/* Ghost / secondary buttons get a dark spinner */
.bl-spinner--dark {
    border-color: rgba(0,0,0,0.15);
    border-top-color: currentColor;
}

button[data-bl-loading="true"] {
    cursor: wait !important;
    opacity: 0.8;
    pointer-events: none;
}

/* Instant press feedback for ALL portal buttons */
.tp-btn-primary:active,
.tp-btn-ghost:active,
.att-cta-btn:active,
.att-modal-save-btn:active,
.att-bulk-btn:active,
.btn:active {
    transform: scale(0.97);
}
`;

function injectStyles() {
    if (document.getElementById('bl-styles')) return;
    const tag = document.createElement('style');
    tag.id = 'bl-styles';
    tag.textContent = BL_STYLES;
    document.head.appendChild(tag);
}

/* ═══════════════════════════════════════════════════════════════
   BUTTON STATE HELPERS
═══════════════════════════════════════════════════════════════ */

/**
 * Detect whether a button uses a dark (ghost/secondary) style
 * so we can pick the right spinner colour.
 */
function isDarkButton(btn) {
    return (
        btn.classList.contains('tp-btn-ghost') ||
        btn.classList.contains('btn-secondary') ||
        btn.classList.contains('att-modal-cancel-btn') ||
        btn.classList.contains('att-btn-print') ||
        btn.classList.contains('att-btn-today') ||
        btn.classList.contains('att-bulk-btn')
    );
}

/**
 * Apply loading state. Returns a restore function.
 * @param {HTMLButtonElement} btn
 * @param {string} [label] — optional override label
 * @returns {() => void}
 */
function applyLoading(btn, label) {
    if (btn.dataset.blLoading === 'true') return () => {};   // already loading

    const originalHTML     = btn.innerHTML;
    const originalDisabled = btn.disabled;
    const originalWidth    = btn.offsetWidth;

    // Lock width so the button doesn't shrink when text changes
    btn.style.minWidth = originalWidth + 'px';
    btn.disabled       = true;
    btn.dataset.blLoading = 'true';

    const spinnerClass = isDarkButton(btn) ? 'bl-spinner bl-spinner--dark' : 'bl-spinner';
    const displayLabel = label || deriveLabel(btn);

    btn.innerHTML = `<span class="${spinnerClass}" aria-hidden="true"></span>${displayLabel ? `&nbsp;${displayLabel}` : ''}`;

    return function restore() {
        btn.innerHTML         = originalHTML;
        btn.disabled          = originalDisabled;
        btn.style.minWidth    = '';
        btn.dataset.blLoading = 'false';
        // Re-init Lucide icons that were inside the button
        try { window.lucide?.createIcons({ nodes: [btn] }); } catch (_) {}
    };
}

/** Extract a short loading label from button content */
function deriveLabel(btn) {
    const text = btn.textContent.trim().replace(/\s+/g, ' ');
    if (!text) return 'Loading…';
    // Map common labels to their loading equivalents
    const map = {
        'save':        'Saving…',
        'saving':      'Saving…',
        'submit':      'Submitting…',
        'submitting':  'Submitting…',
        'send':        'Sending…',
        'approve':     'Approving…',
        'reject':      'Rejecting…',
        'delete':      'Deleting…',
        'removing':    'Removing…',
        'lock':        'Locking…',
        'unlock':      'Unlocking…',
        'publish':     'Publishing…',
        'generate':    'Generating…',
        'print':       'Preparing…',
        'export':      'Exporting…',
        'upload':      'Uploading…',
        'mark':        'Saving…',
        'promote':     'Submitting…',
        'assign':      'Assigning…',
        'migrate':     'Migrating…',
        'refresh':     'Refreshing…',
        'record':      'Recording…',
        'download':    'Downloading…',
        'fix':         'Fixing…',
        'restore':     'Restoring…',
        'create':      'Creating…',
        'add':         'Adding…',
        'update':      'Updating…',
    };
    const lower = text.toLowerCase();
    for (const [key, val] of Object.entries(map)) {
        if (lower.includes(key)) return val;
    }
    return 'Loading…';
}

/* ═══════════════════════════════════════════════════════════════
   ACTION REGISTRY
   Only functions WITHOUT their own internal loading state go here.
   Functions that already disable their own button are excluded
   to avoid double loading states.
═══════════════════════════════════════════════════════════════ */
const ACTION_REGISTRY = {
    // Results
    'saveAllResults':                       'saveAllResults',
    'submitResultsForApproval':             'submitResultsForApproval',
    // Attendance
    'saveAllAttendance':                    'saveAllAttendance',
    'saveModalAttendance':                  'saveModalAttendance',
    'saveAllAttendanceManual':              'saveAllAttendanceManual',
    'printAttendanceRegister':              'printAttendanceRegister',
    // Traits & skills
    'saveBulkTraitsAndSkills':              'saveBulkTraitsAndSkills',
    // Remarks
    'saveRemarks':                          'saveRemarks',
    'refreshRemarkSuggestions':             'refreshRemarkSuggestions',
    // Promotions (teacher)
    'submitPromotionRequest':               'submitPromotionRequest',
    // CBT
    'saveCbtTest':                          'saveCbtTest',
    'publishCbtTest':                       'publishCbtTest',
    'deleteCbtTest':                        'deleteCbtTest',
    // Lesson notes
    'saveLessonNote':                       'saveLessonNote',
    'submitLessonNote':                     'submitLessonNote',
    'deleteLessonNote':                     'deleteLessonNote',
    // Admin — results approval (no internal loading state)
    'rejectResultSubmission':               'rejectResultSubmission',
    'approveAllPendingResults':             'approveAllPendingResults',
    'unlockApprovedResult':                 'unlockApprovedResult',
    // Admin — promotions (no internal loading state)
    'rejectPromotion':                      'rejectPromotion',
    'quickApprovePromotion':                'quickApprovePromotion',
    'quickRejectPromotion':                 'quickRejectPromotion',
    'approveAllPendingPromotions':          'approveAllPendingPromotions',
    'rejectAllPendingPromotions':           'rejectAllPendingPromotions',
    'togglePromotionPeriod':                'togglePromotionPeriod',
    // Admin — fee management (no internal loading state)
    'fixDuplicateFees':                     'fixDuplicateFees',
    'editFeeStructure':                     'editFeeStructure',
    'deleteFeeStructure':                   'deleteFeeStructure',
    // Admin — payments (no internal loading state)
    'loadPupilsForPayment':                 'loadPupilsForPayment',
    'printReceipt':                         'printReceipt',
    // Admin — reports (no internal loading state)
    'loadOutstandingFeesReport':            'loadOutstandingFeesReport',
    'loadFinancialReports':                 'loadFinancialReports',
    'exportFinancialReport':                'exportFinancialReport',
    'exportPupilsData':                     'exportPupilsData',
    'exportResultsData':                    'exportResultsData',
    'exportPupilResults':                   'exportPupilResults',
    'downloadAuditLog':                     'downloadAuditLog',
    // Admin — settings & hierarchy (no internal loading state)
    'saveHierarchyOrder':                   'saveHierarchyOrder',
    'refreshHierarchyUI':                   'refreshHierarchyUI',
    // Admin — users & classes (no internal loading state)
    'deleteItem':                           'deleteItem',
    'deleteAlumni':                         'deleteAlumni',
    'applyBulkAction':                      'applyBulkAction',
    'assignTeacherToClass':                 'assignTeacherToClass',
    'unassignTeacher':                      'unassignTeacher',
    'addClass':                             'addClass',
    'addSubject':                           'addSubject',
    'addAnnouncement':                      'addAnnouncement',
    'saveClassSubjects':                    'saveClassSubjects',
    // Admin — audit log (no internal loading state)
    'loadAuditLog':                         'loadAuditLog',
    'viewAuditDetails':                     'viewAuditDetails',
    // Admin — results viewing (no internal loading state)
    'loadPupilResults':                     'loadPupilResults',
    'loadSessionComparison':                'loadSessionComparison',
    'loadFilteredClasses':                  'loadFilteredClasses',
    'loadFilteredPupils':                   'loadFilteredPupils',
    // Admin — general (no internal loading state)
    'saveSchoolCalendar':                   'saveSchoolCalendar',
};

/* ═══════════════════════════════════════════════════════════════
   ONCLICK PATTERN EXTRACTOR
   Reads onclick="fnName(args)" and returns just "fnName"
═══════════════════════════════════════════════════════════════ */
function extractOnclickFn(btn) {
    const attr = btn.getAttribute('onclick') || '';
    const match = attr.match(/^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/);
    return match ? match[1] : null;
}

/* ═══════════════════════════════════════════════════════════════
   CORE INTERCEPTOR
   Called for every button click in the portal.
═══════════════════════════════════════════════════════════════ */
async function interceptButtonClick(e) {
    const btn = e.target.closest('button, input[type="submit"], input[type="button"]');
    if (!btn) return;
    if (btn.dataset.blLoading === 'true') return;
    if (btn.dataset.blSkip === 'true') return;    // opt-out: data-bl-skip="true"

    // Determine which async function this button calls
    const action = btn.dataset.action || extractOnclickFn(btn);
    if (!action) return;

    const fnName = ACTION_REGISTRY[action] || action;
    const fn = window[fnName];

    // Only intercept if it's an actual async function
    if (typeof fn !== 'function') return;

    // Check if it's async (returns a Promise) by inspecting the constructor name
    const isAsync = fn.constructor?.name === 'AsyncFunction';
    if (!isAsync) return;

    // Stop the onclick from firing natively — we'll call it ourselves
    e.preventDefault();
    e.stopImmediatePropagation();

    // Parse arguments from onclick attribute: fnName(arg1, arg2)
    let fnArgs = [];
    try {
        const attr = btn.getAttribute('onclick') || '';
        const argsMatch = attr.match(/\(([^)]*)\)/);
        if (argsMatch && argsMatch[1].trim()) {
            // Use Function to safely evaluate the argument list
            // eslint-disable-next-line no-new-func
            fnArgs = Function(`"use strict"; return [${argsMatch[1]}]`)();
        }
    } catch (_) { fnArgs = []; }

    const restore = applyLoading(btn);

    try {
        await fn(...fnArgs);
    } catch (err) {
        console.error(`ButtonLoader: error in ${fnName}:`, err);
        // Don't suppress — let existing error handling in each function handle it
    } finally {
        restore();
    }
}

/* ═══════════════════════════════════════════════════════════════
   MUTATION OBSERVER
   Watches for dynamically rendered buttons (from JS sections)
   and patches onclick= buttons that render after page load,
   converting them to use data-action so the interceptor works.
═══════════════════════════════════════════════════════════════ */
function patchButtonsInNode(root) {
    const buttons = root.querySelectorAll ? root.querySelectorAll('button, input[type="submit"]') : [];
    buttons.forEach(btn => {
        if (btn.dataset.blPatched) return;
        btn.dataset.blPatched = 'true';

        const fn = extractOnclickFn(btn);
        if (!fn) return;

        const registeredName = ACTION_REGISTRY[fn] || fn;
        if (typeof window[registeredName] === 'function') {
            // Tag it so the interceptor knows to handle it
            btn.dataset.action = fn;
        }
    });
}

function startMutationObserver() {
    const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                patchButtonsInNode(node);
            });
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

/* ═══════════════════════════════════════════════════════════════
   PROGRAMMATIC API
   Use this from any function that already controls its own button.
   Example:
       const restore = ButtonLoader.start(myBtn);
       await doSomething();
       restore();
═══════════════════════════════════════════════════════════════ */
window.ButtonLoader = {
    /**
     * Manually start loading state on a button.
     * @param {HTMLButtonElement|string} btnOrSelector
     * @param {string} [label]
     * @returns {() => void} restore function
     */
    start(btnOrSelector, label) {
        const btn = typeof btnOrSelector === 'string'
            ? document.querySelector(btnOrSelector)
            : btnOrSelector;
        if (!btn) return () => {};
        return applyLoading(btn, label);
    },

    /**
     * Wrap an async function call with loading state on a button.
     * @param {HTMLButtonElement|string} btnOrSelector
     * @param {() => Promise} asyncFn
     * @param {string} [label]
     */
    async wrap(btnOrSelector, asyncFn, label) {
        const btn = typeof btnOrSelector === 'string'
            ? document.querySelector(btnOrSelector)
            : btnOrSelector;
        if (!btn) { await asyncFn(); return; }
        const restore = applyLoading(btn, label);
        try { await asyncFn(); }
        catch (err) { console.error('ButtonLoader.wrap error:', err); throw err; }
        finally { restore(); }
    },

    /** Add entries to the registry at runtime (for dynamic modules like CBT) */
    register(actionName, windowFnName) {
        ACTION_REGISTRY[actionName] = windowFnName || actionName;
    },
};

/* ═══════════════════════════════════════════════════════════════
   BOOTSTRAP
═══════════════════════════════════════════════════════════════ */
function init() {
    injectStyles();

    // Global delegated click handler — single listener for the entire portal
    document.body.addEventListener('click', interceptButtonClick, true);  // capture phase

    // Patch buttons already in the DOM at load time
    patchButtonsInNode(document.body);

    // Watch for buttons added later (section loads, modals, etc.)
    startMutationObserver();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
