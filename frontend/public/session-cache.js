/**
 * FAHMID NURSERY & PRIMARY SCHOOL
 * Session Cache Manager - Optimization Module
 * 
 * Purpose: Reduce reads by caching session data
 * 
 * @version 1.0.0
 * @date 2026-01-11
 */

'use strict';

/**
 * Session Cache Manager
 * Caches session data to reduce repeated Firestore queries
 */
window.SessionCache = (function() {
  // Private cache storage
  let cache = {
    settings: null,
    sessions: null,
    lastFetch: {
      settings: null,
      sessions: null
    }
  };
  
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  
  /**
   * Check if cache is still valid
   */
  function isCacheValid(type) {
    if (!cache.lastFetch[type]) return false;
    const elapsed = Date.now() - cache.lastFetch[type];
    return elapsed < CACHE_DURATION;
  }
  
  /**
   * Get current settings with caching
   */
  async function getSettings(forceRefresh = false) {
    if (!forceRefresh && isCacheValid('settings') && cache.settings) {
      return cache.settings;
    }
    
    
    try {
      const settingsDoc = await window.db.collection('settings').doc('current').get();
      
      if (settingsDoc.exists) {
        const data = settingsDoc.data();
        
        // Extract session info properly
        let sessionName = '2025/2026';
        let sessionData = null;

        if (data.currentSession && typeof data.currentSession === 'object') {
          sessionName = data.currentSession.name || 
                       `${data.currentSession.startYear}/${data.currentSession.endYear}`;
          sessionData = data.currentSession;
        } else if (data.session) {
          sessionName = data.session;
        }

        // Build complete settings object
        cache.settings = {
          term: data.term || 'First Term',
          session: sessionName,
          currentSession: sessionData,
          resumptionDate: data.resumptionDate || null,
          promotionPeriodActive: data.promotionPeriodActive || false
        };
        
        cache.lastFetch.settings = Date.now();
        
        return cache.settings;
      }
      
      // Return defaults if no settings exist
      const defaults = {
        term: 'First Term',
        session: '2025/2026',
        currentSession: null,
        resumptionDate: null,
        promotionPeriodActive: false
      };
      
      cache.settings = defaults;
      cache.lastFetch.settings = Date.now();
      
      return defaults;
      
    } catch (error) {
      
      // Return cached data if available, even if expired
      if (cache.settings) {
        return cache.settings;
      }
      
      // Return defaults as last resort
      return {
        term: 'First Term',
        session: '2025/2026',
        currentSession: null,
        resumptionDate: null,
        promotionPeriodActive: false
      };
    }
  }
  
  /**
   * Get all sessions (current + archived) with caching
   */
  async function getAllSessions(forceRefresh = false) {
    if (!forceRefresh && isCacheValid('sessions') && cache.sessions) {
      return cache.sessions;
    }
    
    try {
      const settings = await getSettings();
      const currentSession = settings.session;
      
      // Get archived sessions
      const sessionsSnap = await window.db.collection('sessions')
        .orderBy('startYear', 'desc')
        .get();
      
      const sessions = [{
        value: 'current',
        label: `Current Session (${currentSession})`,
        name: currentSession,
        isCurrent: true
      }];
      
      sessionsSnap.forEach(doc => {
        const data = doc.data();
        sessions.push({
          value: data.name,
          label: `${data.name} Session`,
          name: data.name,
          isCurrent: false
        });
      });
      
      cache.sessions = sessions;
      cache.lastFetch.sessions = Date.now();
      
      return sessions;
      
    } catch (error) {
      
      // Return cached data if available
      if (cache.sessions) {
        return cache.sessions;
      }
      
      // Return minimal default
      const settings = await getSettings();
      return [{
        value: 'current',
        label: `Current Session (${settings.session})`,
        name: settings.session,
        isCurrent: true
      }];
    }
  }
  
  /**
   * Clear cache (useful when admin updates settings)
   */
  function clearCache(type = 'all') {
    if (type === 'all' || type === 'settings') {
      cache.settings = null;
      cache.lastFetch.settings = null;
    }
    
    if (type === 'all' || type === 'sessions') {
      cache.sessions = null;
      cache.lastFetch.sessions = null;
    }
  }
  
  /**
   * Get cache status (for debugging)
   */
  function getStatus() {
    return {
      settings: {
        cached: !!cache.settings,
        valid: isCacheValid('settings'),
        lastFetch: cache.lastFetch.settings ? new Date(cache.lastFetch.settings) : null
      },
      sessions: {
        cached: !!cache.sessions,
        valid: isCacheValid('sessions'),
        count: cache.sessions?.length || 0,
        lastFetch: cache.lastFetch.sessions ? new Date(cache.lastFetch.sessions) : null
      }
    };
  }
  
  // Public API
  return {
    getSettings,
    getAllSessions,
    clearCache,
    getStatus
  };
})();

/**
 * Override the original getCurrentSettings to use cache
 */
window.getCurrentSettings = window.SessionCache.getSettings;
