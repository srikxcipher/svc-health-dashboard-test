/**
 * health-dashboard - Facets Platform Service Health Monitor
 * Shows all environments across all projects with status and release uptime %.
 *
 * APIs used:
 *   GET /cc-ui/v1/stacks                                          → list projects
 *   GET /cc-ui/v1/{stackName}/clusters                            → list environments (includes clusterState)
 *   GET /cc-ui/v1/clusters/{clusterId}/deployments/stats?days=30  → release stats (uptime)
 */

(function () {
  var REFRESH_INTERVAL_MS = 60000;

  var STATE_META = {
    RUNNING:          { label: 'Running',         color: '#2e7d32', bg: '#e8f5e9' },
    LAUNCHING:        { label: 'Launching',        color: '#f57c00', bg: '#fff3e0' },
    STOPPED:          { label: 'Stopped',          color: '#616161', bg: '#f5f5f5' },
    SCALE_DOWN:       { label: 'Scaled Down',      color: '#616161', bg: '#f5f5f5' },
    SCALING_DOWN:     { label: 'Scaling Down',     color: '#f57c00', bg: '#fff3e0' },
    SCALING_UP:       { label: 'Scaling Up',       color: '#f57c00', bg: '#fff3e0' },
    DESTROYING:       { label: 'Destroying',       color: '#c62828', bg: '#ffebee' },
    LAUNCH_FAILED:    { label: 'Launch Failed',    color: '#c62828', bg: '#ffebee' },
    DESTROY_FAILED:   { label: 'Destroy Failed',   color: '#c62828', bg: '#ffebee' },
    SCALE_DOWN_FAILED:{ label: 'Scale Down Failed',color: '#c62828', bg: '#ffebee' },
    SCALE_UP_FAILED:  { label: 'Scale Up Failed',  color: '#c62828', bg: '#ffebee' },
    UNKNOWN:          { label: 'Unknown',          color: '#757575', bg: '#eeeeee' },
  };

  var CLOUD_ICONS = {
    AWS:        '☁ AWS',
    AZURE:      '☁ Azure',
    GCP:        '☁ GCP',
    KUBERNETES: '⎈ K8s',
    LOCAL:      '⚙ Local',
    NO_CLOUD:   '— None',
  };

  function uptimeColor(pct) {
    if (pct >= 95) return '#2e7d32';
    if (pct >= 80) return '#f57c00';
    return '#c62828';
  }

  class HealthDashboard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      this._environments = [];    // flat list of enriched env objects
      this._isLoading    = false;
      this._error        = null;
      this._filterProject= '';
      this._filterStatus = '';
      this._refreshTimer = null;
      this._lastRefreshed= null;

      this.render();
    }

    connectedCallback() {
      this._setupListeners();
      this._fetchAll();
      this._refreshTimer = setInterval(function () {
        this._fetchAll();
      }.bind(this), REFRESH_INTERVAL_MS);
    }

    disconnectedCallback() {
      if (this._refreshTimer) clearInterval(this._refreshTimer);
    }

    // ── Rendering ────────────────────────────────────────────────────────────

    render() {
      this.shadowRoot.innerHTML = [
        '<style>',
        '  :host {',
        '    display: block;',
        '    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
        '    background: #f8f9fa;',
        '    min-height: 100vh;',
        '    --primary: #0052cc;',
        '    --border: #dfe1e6;',
        '    --radius: 8px;',
        '  }',
        '  .header {',
        '    background: #fff;',
        '    border-bottom: 1px solid var(--border);',
        '    padding: 16px 24px;',
        '    display: flex;',
        '    align-items: center;',
        '    justify-content: space-between;',
        '    flex-wrap: wrap;',
        '    gap: 12px;',
        '  }',
        '  .header-left { display: flex; align-items: center; gap: 12px; }',
        '  .header h1 { margin: 0; font-size: 1.25rem; color: #172b4d; }',
        '  .badge-count {',
        '    background: #0052cc; color: #fff;',
        '    border-radius: 12px; padding: 2px 10px;',
        '    font-size: 0.75rem; font-weight: 600;',
        '  }',
        '  .refresh-btn {',
        '    background: transparent; border: 1px solid var(--border);',
        '    border-radius: var(--radius); padding: 6px 14px;',
        '    cursor: pointer; font-size: 0.85rem; color: #344563;',
        '    display: flex; align-items: center; gap: 6px;',
        '    transition: background 0.15s;',
        '  }',
        '  .refresh-btn:hover { background: #f4f5f7; }',
        '  .refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }',
        '  .last-refresh { font-size: 0.75rem; color: #97a0af; }',
        '  .filters {',
        '    background: #fff; border-bottom: 1px solid var(--border);',
        '    padding: 10px 24px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center;',
        '  }',
        '  .filters label { font-size: 0.8rem; color: #5e6c84; font-weight: 600; }',
        '  .filters select {',
        '    border: 1px solid var(--border); border-radius: 4px;',
        '    padding: 5px 10px; font-size: 0.85rem; background: #fff;',
        '    cursor: pointer; color: #172b4d;',
        '  }',
        '  .filters select:focus { outline: 2px solid var(--primary); }',
        '  .content { padding: 24px; }',
        '  .summary-bar {',
        '    display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap;',
        '  }',
        '  .summary-chip {',
        '    background: #fff; border: 1px solid var(--border);',
        '    border-radius: var(--radius); padding: 10px 18px;',
        '    display: flex; flex-direction: column; align-items: center;',
        '    min-width: 90px;',
        '  }',
        '  .summary-chip .chip-num { font-size: 1.5rem; font-weight: 700; }',
        '  .summary-chip .chip-lbl { font-size: 0.7rem; color: #5e6c84; font-weight: 600; text-transform: uppercase; margin-top: 2px; }',
        '  .grid {',
        '    display: grid;',
        '    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));',
        '    gap: 16px;',
        '  }',
        '  .card {',
        '    background: #fff; border: 1px solid var(--border);',
        '    border-radius: var(--radius); padding: 18px;',
        '    transition: box-shadow 0.15s;',
        '  }',
        '  .card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }',
        '  .card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }',
        '  .env-name { font-size: 1rem; font-weight: 700; color: #172b4d; }',
        '  .project-name { font-size: 0.75rem; color: #5e6c84; margin-top: 2px; }',
        '  .status-badge {',
        '    border-radius: 12px; padding: 3px 10px;',
        '    font-size: 0.72rem; font-weight: 700; white-space: nowrap;',
        '  }',
        '  .card-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }',
        '  .meta-chip {',
        '    background: #f4f5f7; border-radius: 4px;',
        '    padding: 2px 8px; font-size: 0.72rem; color: #344563;',
        '  }',
        '  .divider { border: none; border-top: 1px solid var(--border); margin: 12px 0; }',
        '  .stats-row { display: flex; gap: 16px; }',
        '  .stat { flex: 1; }',
        '  .stat-val { font-size: 1.1rem; font-weight: 700; color: #172b4d; }',
        '  .stat-lbl { font-size: 0.7rem; color: #5e6c84; font-weight: 600; text-transform: uppercase; }',
        '  .uptime-bar-wrap { margin-top: 10px; }',
        '  .uptime-bar-bg { background: #dfe1e6; border-radius: 4px; height: 6px; overflow: hidden; }',
        '  .uptime-bar-fill { height: 6px; border-radius: 4px; transition: width 0.4s; }',
        '  .uptime-lbl { font-size: 0.72rem; color: #5e6c84; margin-top: 4px; display: flex; justify-content: space-between; }',
        '  .loading-wrap { text-align: center; padding: 60px 24px; }',
        '  .spinner {',
        '    width: 36px; height: 36px;',
        '    border: 3px solid #dfe1e6; border-top-color: var(--primary);',
        '    border-radius: 50%; animation: spin 0.7s linear infinite;',
        '    margin: 0 auto 16px;',
        '  }',
        '  @keyframes spin { to { transform: rotate(360deg); } }',
        '  .loading-text { color: #5e6c84; }',
        '  .error-box {',
        '    background: #ffebee; border: 1px solid #ef9a9a; border-radius: var(--radius);',
        '    padding: 16px; color: #c62828; margin: 24px;',
        '  }',
        '  .empty-box {',
        '    text-align: center; padding: 60px 24px; color: #5e6c84;',
        '  }',
        '  .empty-icon { font-size: 2.5rem; margin-bottom: 12px; }',
        '</style>',

        '<div class="header">',
        '  <div class="header-left">',
        '    <h1>Service Health Dashboard</h1>',
        '    <span class="badge-count" id="env-count">0</span>',
        '  </div>',
        '  <div style="display:flex;align-items:center;gap:12px;">',
        '    <span class="last-refresh" id="last-refresh"></span>',
        '    <button class="refresh-btn" id="refresh-btn">↻ Refresh</button>',
        '  </div>',
        '</div>',

        '<div class="filters" id="filters-bar">',
        '  <label>Project</label>',
        '  <select id="filter-project"><option value="">All Projects</option></select>',
        '  <label>Status</label>',
        '  <select id="filter-status">',
        '    <option value="">All Statuses</option>',
        '    <option value="RUNNING">Running</option>',
        '    <option value="STOPPED">Stopped</option>',
        '    <option value="LAUNCHING">Launching</option>',
        '    <option value="LAUNCH_FAILED">Launch Failed</option>',
        '    <option value="DESTROYING">Destroying</option>',
        '    <option value="SCALE_DOWN">Scaled Down</option>',
        '    <option value="UNKNOWN">Unknown</option>',
        '  </select>',
        '</div>',

        '<div class="content" id="content">',
        '  <div class="loading-wrap" id="loading">',
        '    <div class="spinner"></div>',
        '    <div class="loading-text">Loading environments…</div>',
        '  </div>',
        '  <div class="error-box" id="error-box" style="display:none;"></div>',
        '  <div id="main-content" style="display:none;">',
        '    <div class="summary-bar" id="summary-bar"></div>',
        '    <div class="grid" id="cards-grid"></div>',
        '    <div class="empty-box" id="empty-box" style="display:none;">',
        '      <div class="empty-icon">🔍</div>',
        '      <div>No environments match the current filters.</div>',
        '    </div>',
        '  </div>',
        '</div>',
      ].join('\n');
    }

    // ── Event Listeners ───────────────────────────────────────────────────────

    _setupListeners() {
      var self = this;

      this.shadowRoot.getElementById('refresh-btn').addEventListener('click', function () {
        self._fetchAll();
      });

      this.shadowRoot.getElementById('filter-project').addEventListener('change', function (e) {
        self._filterProject = e.target.value;
        self._renderCards();
      });

      this.shadowRoot.getElementById('filter-status').addEventListener('change', function (e) {
        self._filterStatus = e.target.value;
        self._renderCards();
      });
    }

    // ── Data Fetching ─────────────────────────────────────────────────────────

    async _fetchAll() {
      if (this._isLoading) return;
      this._isLoading = true;
      this._setRefreshBtnDisabled(true);
      this._showLoading(true);
      this._hideError();

      try {
        // 1. List all projects
        var stacksRes = await fetch('/cc-ui/v1/stacks');
        if (!stacksRes.ok) throw new Error('Failed to load projects (HTTP ' + stacksRes.status + ')');
        var stacks = await stacksRes.json();
        var stackNames = [];
        if (Array.isArray(stacks)) {
          stackNames = stacks.map(function (s) { return typeof s === 'string' ? s : (s.name || s.stackName || ''); }).filter(Boolean);
        } else if (stacks && Array.isArray(stacks.content)) {
          stackNames = stacks.content.map(function (s) { return s.name || s.stackName || ''; }).filter(Boolean);
        }

        // 2. For each project, fetch environments
        var allEnvs = [];
        await Promise.all(stackNames.map(async function (stackName) {
          try {
            var clRes = await fetch('/cc-ui/v1/' + encodeURIComponent(stackName) + '/clusters');
            if (!clRes.ok) return;
            var clusters = await clRes.json();
            var list = Array.isArray(clusters) ? clusters : (clusters.content || []);
            list.forEach(function (cl) {
              allEnvs.push({ stackName: stackName, cluster: cl, stats: null });
            });
          } catch (e) { /* skip failed projects */ }
        }));

        // 3. Fetch deployment stats per environment in parallel
        await Promise.all(allEnvs.map(async function (env) {
          try {
            var sRes = await fetch('/cc-ui/v1/clusters/' + encodeURIComponent(env.cluster.id) + '/deployments/stats?days=30');
            if (sRes.ok) {
              env.stats = await sRes.json();
            }
          } catch (e) { /* stats optional */ }
        }));

        this._environments = allEnvs;
        this._populateProjectFilter();
        this._lastRefreshed = new Date();
        this._showLoading(false);
        this._showMainContent(true);
        this._renderCards();
        this._updateLastRefreshed();
      } catch (err) {
        this._showLoading(false);
        this._showError(err.message);
      } finally {
        this._isLoading = false;
        this._setRefreshBtnDisabled(false);
      }
    }

    // ── UI Updates ────────────────────────────────────────────────────────────

    _populateProjectFilter() {
      var sel = this.shadowRoot.getElementById('filter-project');
      var current = sel.value;
      var projects = [];
      this._environments.forEach(function (e) {
        if (projects.indexOf(e.stackName) === -1) projects.push(e.stackName);
      });
      projects.sort();
      sel.innerHTML = '<option value="">All Projects</option>' +
        projects.map(function (p) {
          return '<option value="' + p + '"' + (current === p ? ' selected' : '') + '>' + p + '</option>';
        }).join('');
    }

    _renderCards() {
      var self = this;
      var envs = this._environments.filter(function (e) {
        if (self._filterProject && e.stackName !== self._filterProject) return false;
        if (self._filterStatus && e.cluster.clusterState !== self._filterStatus) return false;
        return true;
      });

      // Update count badge
      this.shadowRoot.getElementById('env-count').textContent = envs.length;

      // Summary chips
      var counts = { running: 0, stopped: 0, failed: 0, other: 0 };
      envs.forEach(function (e) {
        var s = e.cluster.clusterState || 'UNKNOWN';
        if (s === 'RUNNING') counts.running++;
        else if (s === 'STOPPED' || s === 'SCALE_DOWN') counts.stopped++;
        else if (s.indexOf('FAILED') !== -1) counts.failed++;
        else counts.other++;
      });

      this.shadowRoot.getElementById('summary-bar').innerHTML = [
        self._chipHtml(envs.length, 'Total', '#0052cc'),
        self._chipHtml(counts.running, 'Running', '#2e7d32'),
        self._chipHtml(counts.stopped, 'Stopped', '#616161'),
        self._chipHtml(counts.failed, 'Failed', '#c62828'),
        self._chipHtml(counts.other, 'Other', '#f57c00'),
      ].join('');

      var grid = this.shadowRoot.getElementById('cards-grid');
      var empty = this.shadowRoot.getElementById('empty-box');

      if (envs.length === 0) {
        grid.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';
      grid.innerHTML = envs.map(function (e) { return self._cardHtml(e); }).join('');
    }

    _chipHtml(num, label, color) {
      return '<div class="summary-chip"><span class="chip-num" style="color:' + color + '">' + num + '</span><span class="chip-lbl">' + label + '</span></div>';
    }

    _cardHtml(env) {
      var cl = env.cluster;
      var state = cl.clusterState || 'UNKNOWN';
      var meta = STATE_META[state] || STATE_META.UNKNOWN;
      var cloudLabel = CLOUD_ICONS[cl.cloud] || cl.cloud || '';

      // Uptime calculation
      var uptimePct = null;
      var successCount = 0;
      var failedCount = 0;
      if (env.stats && env.stats.stats) {
        successCount = env.stats.stats.successReleases || 0;
        failedCount = env.stats.stats.failedReleases || 0;
        var total = successCount + failedCount;
        if (total > 0) uptimePct = Math.round((successCount / total) * 100);
      }

      var uptimeHtml = '';
      if (uptimePct !== null) {
        var uColor = uptimeColor(uptimePct);
        uptimeHtml = [
          '<div class="uptime-bar-wrap">',
          '  <div class="uptime-bar-bg">',
          '    <div class="uptime-bar-fill" style="width:' + uptimePct + '%;background:' + uColor + '"></div>',
          '  </div>',
          '  <div class="uptime-lbl">',
          '    <span>Release Success Rate (30d)</span>',
          '    <span style="color:' + uColor + ';font-weight:700;">' + uptimePct + '%</span>',
          '  </div>',
          '</div>',
        ].join('');
      }

      var metaChips = '';
      if (cloudLabel) metaChips += '<span class="meta-chip">' + cloudLabel + '</span>';
      if (cl.isEphemeral) metaChips += '<span class="meta-chip">Ephemeral</span>';
      if (cl.pauseReleases) metaChips += '<span class="meta-chip">⏸ Paused</span>';
      if (cl.branch) metaChips += '<span class="meta-chip">⎇ ' + cl.branch + '</span>';

      return [
        '<div class="card">',
        '  <div class="card-top">',
        '    <div>',
        '      <div class="env-name">' + this._esc(cl.name || cl.id) + '</div>',
        '      <div class="project-name">' + this._esc(env.stackName) + '</div>',
        '    </div>',
        '    <span class="status-badge" style="background:' + meta.bg + ';color:' + meta.color + '">' + meta.label + '</span>',
        '  </div>',
        '  <div class="card-meta">' + (metaChips || '<span class="meta-chip">—</span>') + '</div>',
        '  <hr class="divider">',
        '  <div class="stats-row">',
        '    <div class="stat"><div class="stat-val" style="color:#2e7d32">' + successCount + '</div><div class="stat-lbl">Success</div></div>',
        '    <div class="stat"><div class="stat-val" style="color:#c62828">' + failedCount + '</div><div class="stat-lbl">Failed</div></div>',
        '    <div class="stat"><div class="stat-val">' + (uptimePct !== null ? uptimePct + '%' : '—') + '</div><div class="stat-lbl">Uptime</div></div>',
        '  </div>',
        uptimeHtml,
        '</div>',
      ].join('\n');
    }

    _esc(str) {
      return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    _showLoading(show) {
      this.shadowRoot.getElementById('loading').style.display = show ? 'block' : 'none';
    }

    _showMainContent(show) {
      this.shadowRoot.getElementById('main-content').style.display = show ? 'block' : 'none';
    }

    _showError(msg) {
      var el = this.shadowRoot.getElementById('error-box');
      el.textContent = '⚠ ' + msg;
      el.style.display = 'block';
    }

    _hideError() {
      this.shadowRoot.getElementById('error-box').style.display = 'none';
    }

    _setRefreshBtnDisabled(disabled) {
      var btn = this.shadowRoot.getElementById('refresh-btn');
      if (btn) btn.disabled = disabled;
    }

    _updateLastRefreshed() {
      var el = this.shadowRoot.getElementById('last-refresh');
      if (el && this._lastRefreshed) {
        el.textContent = 'Updated ' + this._lastRefreshed.toLocaleTimeString();
      }
    }
  }

  customElements.define('health-dashboard', HealthDashboard);
})();
