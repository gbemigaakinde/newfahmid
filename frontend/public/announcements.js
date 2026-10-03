/**
 * FAHMID NURSERY & PRIMARY SCHOOL
 * Shared Announcements Module
 */
'use strict';

(function () {

  /* Load and render announcements targeted at a specific user. */
  window.loadAnnouncementsForUser = async function (role, userId, classId, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
      const db = window.db;
      if (!db) return;

      const audienceKeys = [
        'all',
        role === 'teacher' ? 'teachers' : 'pupils'
      ];
      if (role === 'pupil' && classId) {
        audienceKeys.push('class:' + classId);
      }
      audienceKeys.push('user:' + userId);

      const snap = await db
        .collection('announcements')
        .orderBy('createdAt', 'desc')
        .limit(60)
        .get();

      const now = new Date();

      const relevant = [];
      snap.forEach(function (doc) {
        const data = doc.data();
        const audience = data.targetAudience || 'all';
        if (audienceKeys.indexOf(audience) === -1) return;

        if (data.expiresAt && data.expiresAt.toDate && data.expiresAt.toDate() < now) return;

        relevant.push(Object.assign({ id: doc.id }, data));
      });

      if (relevant.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
      }

      const storageKey = 'dismissed_ann_' + userId;
      var dismissed = [];
      try {
        dismissed = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
      } catch (e) { dismissed = []; }

      const toShow = relevant.filter(function (a) {
        return dismissed.indexOf(a.id) === -1;
      });

      if (toShow.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
      }

      container.style.display = 'block';
      container.innerHTML = _buildBannersHTML(toShow, userId, storageKey);

    } catch (err) {}
  };


  /* Dismiss one announcement banner for this browser session. */
  window.dismissAnnouncement = function (announcementId, userId, storageKey) {
    try {
      var dismissed = [];
      try {
        dismissed = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
      } catch (e) { dismissed = []; }
      if (dismissed.indexOf(announcementId) === -1) {
        dismissed.push(announcementId);
      }
      sessionStorage.setItem(storageKey, JSON.stringify(dismissed));
    } catch (e) {}

    var banner = document.getElementById('ann-banner-' + announcementId);
    if (banner) {
      banner.style.transition = 'opacity 0.25s ease, max-height 0.35s ease, padding 0.35s ease, margin 0.35s ease';
      banner.style.opacity = '0';
      banner.style.maxHeight = '0';
      banner.style.paddingTop = '0';
      banner.style.paddingBottom = '0';
      banner.style.marginBottom = '0';
      banner.style.overflow = 'hidden';
      setTimeout(function () {
        if (banner.parentNode) banner.parentNode.removeChild(banner);
        var remaining = document.querySelectorAll('.ann-banner-item');
        if (remaining.length === 0) {
          var wrapper = document.getElementById('announcements-banner-container');
          if (wrapper) wrapper.style.display = 'none';
        }
      }, 380);
    }
  };


  function _buildBannersHTML(announcements, userId, storageKey) {
    return announcements.map(function (ann) {
      var dateStr = '';
      if (ann.createdAt && ann.createdAt.toDate) {
        dateStr = ann.createdAt.toDate().toLocaleDateString('en-GB', {
          day: 'numeric', month: 'short', year: 'numeric'
        });
      }

      var style = _priorityStyles(ann.priority || 'normal');
      var audienceLabel = _audienceLabel(ann.targetAudience);

      return [
        '<div class="ann-banner-item" id="ann-banner-' + ann.id + '"',
        '     style="' + style.wrapper + '">',
        '  <div class="ann-banner-layout">',
        '    <div class="ann-banner-icon-wrap" style="' + style.icon + '">',
        '      <i class="' + style.iconClass + '"></i>',
        '    </div>',
        '    <div class="ann-banner-body">',
        '      <div class="ann-banner-top">',
        '        <span class="ann-banner-title">' + _escHtml(ann.title) + '</span>',
        '        <button class="ann-dismiss-btn"',
        '                onclick="dismissAnnouncement(\'' + ann.id + '\',\'' + userId + '\',\'' + storageKey + '\')"',
        '                aria-label="Dismiss this announcement"',
        '                title="Dismiss">',
        '          <i class="ph ph-x"></i>',
        '        </button>',
        '      </div>',
        '      <div class="ann-banner-meta">',
        (dateStr ? '        <span class="ann-meta-date">' + dateStr + '</span>' : ''),
        (audienceLabel ? '        <span class="ann-audience-chip">' + audienceLabel + '</span>' : ''),
        _priorityChip(ann.priority),
        '      </div>',
        '      <div class="ann-banner-content">' + _escHtml(ann.content) + '</div>',
        '    </div>',
        '  </div>',
        '</div>'
      ].join('\n');
    }).join('\n');
  }

  function _priorityStyles(priority) {
    var map = {
      urgent: {
        wrapper: 'background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;',
        icon:    'background:#fecaca;color:#dc2626;',
        iconClass: 'ph ph-warning'
      },
      important: {
        wrapper: 'background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #d97706;',
        icon:    'background:#fde68a;color:#d97706;',
        iconClass: 'ph ph-star'
      },
      normal: {
        wrapper: 'background:#eff6ff;border:1px solid #bfdbfe;border-left:4px solid #1a56db;',
        icon:    'background:#bfdbfe;color:#1a56db;',
        iconClass: 'ph ph-megaphone'
      }
    };
    return map[priority] || map.normal;
  }

  function _priorityChip(priority) {
    if (priority === 'urgent') {
      return '<span class="ann-priority-chip ann-priority-chip--urgent">Urgent</span>';
    }
    if (priority === 'important') {
      return '<span class="ann-priority-chip ann-priority-chip--important">Important</span>';
    }
    return '';
  }

  function _audienceLabel(audience) {
    if (!audience || audience === 'all')         return 'All Users';
    if (audience === 'teachers')                 return 'All Teachers';
    if (audience === 'pupils')                   return 'All Pupils';
    if (audience.indexOf('class:') === 0)        return 'Your Class';
    if (audience.indexOf('user:') === 0)         return 'Personal';
    return '';
  }

  function _escHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#039;')
      .replace(/\n/g, '<br>');
  }


  /* SHARED CSS — injected once into <head> */

  var CSS = '\n' +
    '#announcements-banner-container {\n' +
    '  display: none;\n' +
    '}\n' +
    '\n' +
    '.ann-banner-item {\n' +
    '  border-radius: 10px;\n' +
    '  padding: 14px 16px;\n' +
    '  margin-bottom: 10px;\n' +
    '  max-height: 500px;\n' +
    '  animation: ann-slide-in 0.3s ease both;\n' +
    '}\n' +
    '\n' +
    '@keyframes ann-slide-in {\n' +
    '  from { opacity: 0; transform: translateY(-8px); }\n' +
    '  to   { opacity: 1; transform: translateY(0); }\n' +
    '}\n' +
    '\n' +
    '.ann-banner-layout {\n' +
    '  display: flex;\n' +
    '  align-items: flex-start;\n' +
    '  gap: 12px;\n' +
    '}\n' +
    '\n' +
    '.ann-banner-icon-wrap {\n' +
    '  width: 34px;\n' +
    '  height: 34px;\n' +
    '  border-radius: 8px;\n' +
    '  display: flex;\n' +
    '  align-items: center;\n' +
    '  justify-content: center;\n' +
    '  flex-shrink: 0;\n' +
    '  font-size: 16px;\n' +
    '  margin-top: 1px;\n' +
    '}\n' +
    '\n' +
    '.ann-banner-body {\n' +
    '  flex: 1;\n' +
    '  min-width: 0;\n' +
    '  display: flex;\n' +
    '  flex-direction: column;\n' +
    '  gap: 5px;\n' +
    '}\n' +
    '\n' +
    '.ann-banner-top {\n' +
    '  display: flex;\n' +
    '  align-items: flex-start;\n' +
    '  justify-content: space-between;\n' +
    '  gap: 8px;\n' +
    '}\n' +
    '\n' +
    '.ann-banner-title {\n' +
    '  font-size: 0.9375rem;\n' +
    '  font-weight: 700;\n' +
    '  color: #0f172a;\n' +
    '  line-height: 1.3;\n' +
    '  flex: 1;\n' +
    '  min-width: 0;\n' +
    '}\n' +
    '\n' +
    '.ann-dismiss-btn {\n' +
    '  background: none;\n' +
    '  border: none;\n' +
    '  padding: 2px 4px;\n' +
    '  cursor: pointer;\n' +
    '  color: #94a3b8;\n' +
    '  font-size: 16px;\n' +
    '  line-height: 1;\n' +
    '  flex-shrink: 0;\n' +
    '  border-radius: 4px;\n' +
    '  transition: color 0.15s ease, background 0.15s ease;\n' +
    '  margin-top: -1px;\n' +
    '}\n' +
    '\n' +
    '.ann-dismiss-btn:hover {\n' +
    '  color: #475569;\n' +
    '  background: rgba(0,0,0,0.06);\n' +
    '}\n' +
    '\n' +
    '.ann-banner-meta {\n' +
    '  display: flex;\n' +
    '  align-items: center;\n' +
    '  gap: 8px;\n' +
    '  flex-wrap: wrap;\n' +
    '}\n' +
    '\n' +
    '.ann-meta-date {\n' +
    '  font-size: 0.75rem;\n' +
    '  color: #64748b;\n' +
    '  font-weight: 500;\n' +
    '}\n' +
    '\n' +
    '.ann-audience-chip {\n' +
    '  display: inline-block;\n' +
    '  padding: 1px 8px;\n' +
    '  border-radius: 999px;\n' +
    '  font-size: 0.6875rem;\n' +
    '  font-weight: 700;\n' +
    '  background: rgba(255,255,255,0.75);\n' +
    '  border: 1px solid rgba(0,0,0,0.1);\n' +
    '  color: #475569;\n' +
    '  text-transform: uppercase;\n' +
    '  letter-spacing: 0.04em;\n' +
    '}\n' +
    '\n' +
    '.ann-priority-chip {\n' +
    '  display: inline-block;\n' +
    '  padding: 1px 8px;\n' +
    '  border-radius: 999px;\n' +
    '  font-size: 0.6875rem;\n' +
    '  font-weight: 800;\n' +
    '  text-transform: uppercase;\n' +
    '  letter-spacing: 0.05em;\n' +
    '}\n' +
    '\n' +
    '.ann-priority-chip--urgent {\n' +
    '  background: #fee2e2;\n' +
    '  color: #dc2626;\n' +
    '}\n' +
    '\n' +
    '.ann-priority-chip--important {\n' +
    '  background: #fef3c7;\n' +
    '  color: #d97706;\n' +
    '}\n' +
    '\n' +
    '.ann-banner-content {\n' +
    '  font-size: 0.875rem;\n' +
    '  color: #374151;\n' +
    '  line-height: 1.6;\n' +
    '  margin-top: 2px;\n' +
    '}\n' +
    '\n' +
    '@media (max-width: 480px) {\n' +
    '  .ann-banner-layout { gap: 8px; }\n' +
    '  .ann-banner-icon-wrap { width: 28px; height: 28px; font-size: 14px; }\n' +
    '  .ann-banner-title { font-size: 0.875rem; }\n' +
    '  .ann-banner-content { font-size: 0.8125rem; }\n' +
    '}\n';

  if (!document.getElementById('ann-shared-css')) {
    var style = document.createElement('style');
    style.id = 'ann-shared-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

}());
