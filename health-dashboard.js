/**
 * health-dashboard - Facets Platform Service Health Monitor
 *
 * Usage:
 *   <health-dashboard
 *     cp-url="https://your-cp.facets.cloud"
 *     username="your-username"
 *     token="your-api-token">
 *   </health-dashboard>
 *
 * All three attributes are required. They are injected at build time
 * by the GitHub Actions workflow from repository variables / secrets.
 *
 * APIs used:
 *   GET /cc-ui/v1/stacks/                                         → list projects
 *   GET /cc-ui/v1/stacks/{stackName}/clusters-overview            → list environments
 *   GET /cc-ui/v1/clusters/{clusterId}/deployments/stats?days=30  → release stats
 */

(function () {
  var REFRESH_INTERVAL_MS = 60000;

  var STATE_META = {
    RUNNING:           { label: 'Running',          color: '#2e7d32', bg: '#e8f5e9' },
    LAUNCHING:         { label: 'Launching',         color: '#f57c00', bg: '#fff3e0' },
    STOPPED:           { label: 'Stopped',           color: '#616161', bg: '#f5f5f5' },
    SCALE_DOWN:        { label: 'Scaled Down',       color: '#616161', bg: '#f5f5f5' },
    SCALING_DOWN:      { label: 'Scaling Down',      color: '#f57c00', bg: '#fff3e0' },
    SCALING_UP:        { label: 'Scaling Up',        color: '#f57c00', bg: '#fff3e0' },
    DESTROYING:        { label: 'Destroying',        color: '#c62828', bg: '#ffebee' },
    LAUNCH_FAILED:     { label: 'Launch Failed',     color: '#c62828', bg: '#ffebee' },
    DESTROY_FAILED:    { label: 'Destroy Failed',    color: '#c62828', bg: '#ffebee' },
    SCALE_DOWN_FAILED: { label: 'Scale Down Failed', color: '#c62828', bg: '#ffebee' },
    SCALE_UP_FAILED:   { label: 'Scale Up Failed',   color: '#c62828', bg: '#ffebee' },
    UNKNOWN:           { label: 'Unknown',           color: '#757575', bg: '#eeeeee' },
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
    static get observedAttributes() {
      return ['cp-url', 'username', 'token'];
    }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      this._environments = [];
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

    // ── Config ────────────────────────────────────────────────────────────────

    get _cpUrl() {
      return (this.getAttribute('cp-url') || '').replace(/\/$/, '');
    }

    get _username() {
      return this.getAttribute('username') || '';
    }

    get _token() {
      return this.getAttribute('token') || '';
    }

    _authHeader() {
      var encoded = btoa(this._username + ':' + this._token);
      return {
        'Authorization': 'Basic ' + encoded,
        'Accept': 'application/json',
      };
    }

    // ── Rendering ────────────────────────────────────────────────────────────

    render() {
      this.shadowRoot.innerHTML = [
        '<style>',
        '  :host {',
        '    display: block;',
        '    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
        '    background: #f8f9fa;',
        '    min-height: 100vh;',
        '    --primary: #645DF6;',
        '    --teal: #00C2BB;',
        '    --border: #e5e7eb;',
        '    --radius: 8px;',
        '  }',
        '  .header {',
        '    background: #fff;',
        '    border-bottom: 1px solid var(--border);',
        '    padding: 14px 24px;',
        '    display: flex; align-items: center; justify-content: space-between;',
        '    flex-wrap: wrap; gap: 12px;',
        '  }',
        '  .header-left { display: flex; align-items: center; gap: 12px; }',
        '  .header-logo { height: 22px; width: auto; }',
        '  .header-title { font-size: 0.9rem; font-weight: 600; color: #374151; }',
        '  .badge-count {',
        '    background: var(--primary); color: #fff;',
        '    border-radius: 12px; padding: 2px 10px;',
        '    font-size: 0.72rem; font-weight: 600;',
        '  }',
        '  .cp-label {',
        '    font-size: 0.72rem; color: #9ca3af;',
        '    background: #f3f4f6; border-radius: 4px; padding: 2px 8px;',
        '    max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
        '  }',
        '  .refresh-btn {',
        '    background: transparent; border: 1px solid var(--border);',
        '    border-radius: var(--radius); padding: 6px 14px;',
        '    cursor: pointer; font-size: 0.82rem; color: #374151;',
        '    display: flex; align-items: center; gap: 6px; transition: background 0.15s;',
        '  }',
        '  .refresh-btn:hover { background: #f3f4f6; }',
        '  .refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }',
        '  .last-refresh { font-size: 0.72rem; color: #9ca3af; }',
        '  .filters {',
        '    background: #fff; border-bottom: 1px solid var(--border);',
        '    padding: 10px 24px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center;',
        '  }',
        '  .filters label { font-size: 0.78rem; color: #6b7280; font-weight: 600; }',
        '  .filters select {',
        '    border: 1px solid var(--border); border-radius: 4px;',
        '    padding: 5px 10px; font-size: 0.82rem; background: #fff;',
        '    cursor: pointer; color: #374151;',
        '  }',
        '  .filters select:focus { outline: 2px solid var(--primary); }',
        '  .content { padding: 24px; }',
        '  .summary-bar { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }',
        '  .summary-chip {',
        '    background: #fff; border: 1px solid var(--border);',
        '    border-radius: var(--radius); padding: 10px 18px;',
        '    display: flex; flex-direction: column; align-items: center; min-width: 86px;',
        '  }',
        '  .summary-chip .chip-num { font-size: 1.4rem; font-weight: 700; }',
        '  .summary-chip .chip-lbl { font-size: 0.68rem; color: #6b7280; font-weight: 600; text-transform: uppercase; margin-top: 2px; }',
        '  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }',
        '  .card {',
        '    background: #fff; border: 1px solid var(--border);',
        '    border-radius: var(--radius); padding: 16px;',
        '    transition: box-shadow 0.15s;',
        '  }',
        '  .card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.07); }',
        '  .card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }',
        '  .env-name { font-size: 0.95rem; font-weight: 700; color: #111827; }',
        '  .project-name { font-size: 0.72rem; color: #6b7280; margin-top: 2px; }',
        '  .status-badge { border-radius: 12px; padding: 3px 10px; font-size: 0.7rem; font-weight: 700; white-space: nowrap; }',
        '  .card-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }',
        '  .meta-chip { background: #f3f4f6; border-radius: 4px; padding: 2px 8px; font-size: 0.7rem; color: #374151; }',
        '  .divider { border: none; border-top: 1px solid var(--border); margin: 10px 0; }',
        '  .stats-row { display: flex; gap: 16px; }',
        '  .stat { flex: 1; }',
        '  .stat-val { font-size: 1.05rem; font-weight: 700; color: #111827; }',
        '  .stat-lbl { font-size: 0.68rem; color: #6b7280; font-weight: 600; text-transform: uppercase; }',
        '  .uptime-bar-wrap { margin-top: 10px; }',
        '  .uptime-bar-bg { background: #e5e7eb; border-radius: 4px; height: 5px; overflow: hidden; }',
        '  .uptime-bar-fill { height: 5px; border-radius: 4px; transition: width 0.4s; }',
        '  .uptime-lbl { font-size: 0.7rem; color: #6b7280; margin-top: 4px; display: flex; justify-content: space-between; }',
        '  .loading-wrap { text-align: center; padding: 60px 24px; }',
        '  .spinner {',
        '    width: 32px; height: 32px;',
        '    border: 3px solid #e5e7eb; border-top-color: var(--primary);',
        '    border-radius: 50%; animation: spin 0.7s linear infinite; margin: 0 auto 14px;',
        '  }',
        '  @keyframes spin { to { transform: rotate(360deg); } }',
        '  .loading-text { color: #6b7280; font-size: 0.88rem; }',
        '  .error-box {',
        '    background: #fef2f2; border: 1px solid #fca5a5; border-radius: var(--radius);',
        '    padding: 14px 18px; color: #dc2626; margin: 24px; font-size: 0.88rem;',
        '  }',
        '  .config-error {',
        '    background: #fef9c3; border: 1px solid #fde68a; border-radius: var(--radius);',
        '    padding: 20px 24px; margin: 24px; color: #92400e; font-size: 0.9rem;',
        '  }',
        '  .config-error code { background: #fde68a; padding: 1px 6px; border-radius: 3px; font-size: 0.85rem; }',
        '  .empty-box { text-align: center; padding: 60px 24px; color: #6b7280; }',
        '  .empty-icon { font-size: 2.2rem; margin-bottom: 10px; }',
        '</style>',

        '<div class="header">',
        '  <div class="header-left">',
        '    <svg class="header-logo" viewBox="0 0 119 20" fill="none" xmlns="http://www.w3.org/2000/svg">',
        '      <path d="M15.8331 19.9996V0L0 19.9996H15.8331Z" fill="#00C2BB"/>',
        '      <path d="M33.5 0H17.6669V5H29.5417L33.5 0Z" fill="#645DF6"/>',
        '      <path d="M17.7501 14V20L22.5 14H17.7501Z" fill="#645DF6"/>',
        '      <path d="M28.082 7H17.7905V12H24.1238L28.082 7Z" fill="#00C2BB"/>',
        '      <path d="M37.329 16V6.207H43.704V7.587H38.88V10.532H43.178V11.912H38.88V16H37.329Z" fill="#645DF6"/>',
        '    </svg>',
        '    <span class="header-title">Environment Status</span>',
        '    <span class="badge-count" id="env-count">0</span>',
        '  </div>',
        '  <div style="display:flex;align-items:center;gap:10px;">',
        '    <span class="cp-label" id="cp-label"></span>',
        '    <span class="last-refresh" id="last-refresh"></span>',
        '    <button class="refresh-btn" id="refresh-btn">↻ Refresh</button>',
        '  </div>',
        '</div>',

        '<div class="filters">',
        '  <label>Project</label>',
        '  <select id="filter-project"><option value="">All Projects</option></select>',
        '  <label>Status</label>',
        '  <select id="filter-status">',
        '    <option value="">All Statuses</option>',
        '    <option value="RUNNING">Running</option>',
        '    <option value="STOPPED">Stopped</option>',
        '    <option value="SCALE_DOWN">Scaled Down</option>',
        '    <option value="LAUNCHING">Launching</option>',
        '    <option value="LAUNCH_FAILED">Launch Failed</option>',
        '    <option value="DESTROYING">Destroying</option>',
        '    <option value="UNKNOWN">Unknown</option>',
        '  </select>',
        '</div>',

        '<div class="content" id="content">',
        '  <div class="loading-wrap" id="loading">',
        '    <div class="spinner"></div>',
        '    <div class="loading-text">Loading environments…</div>',
        '  </div>',
        '  <div class="config-error" id="config-error" style="display:none;">',
        '    ⚠ Missing configuration. The <code>cp-url</code>, <code>username</code>, and <code>token</code> attributes are required.',
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

      if (!this._cpUrl || !this._username || !this._token) {
        this._showLoading(false);
        this.shadowRoot.getElementById('config-error').style.display = 'block';
        return;
      }

      this._isLoading = true;
      this._setRefreshBtnDisabled(true);
      this._showLoading(true);
      this._hideError();

      // Show which CP we're connected to
      var cpLabel = this.shadowRoot.getElementById('cp-label');
      if (cpLabel) cpLabel.textContent = this._cpUrl.replace(/^https?:\/\//, '');

      try {
        // 1. List all stacks/projects
        var stacksRes = await fetch(this._cpUrl + '/cc-ui/v1/stacks/', { headers: this._authHeader() });
        if (!stacksRes.ok) throw new Error('Failed to load projects (HTTP ' + stacksRes.status + ')');
        var stacks = await stacksRes.json();
        var stackNames = Array.isArray(stacks)
          ? stacks.map(function (s) { return typeof s === 'string' ? s : (s.name || s.stackName || ''); })
          : (stacks.content || []).map(function (s) { return s.name || s.stackName || ''; });
        stackNames = stackNames.filter(Boolean);

        // 2. Fetch environments for each project
        var allEnvs = [];
        await Promise.all(stackNames.map(async function (stackName) {
          try {
            var clRes = await fetch(
              this._cpUrl + '/cc-ui/v1/stacks/' + encodeURIComponent(stackName) + '/clusters-overview',
              { headers: this._authHeader() }
            );
            if (!clRes.ok) return;
            var data = await clRes.json();
            var list = Array.isArray(data) ? data : (data.content || []);
            list.forEach(function (overview) {
              var cl = overview.cluster || overview;
              allEnvs.push({
                stackName: stackName,
                cluster: cl,
                clusterState: overview.clusterState || cl.clusterState || 'UNKNOWN',
                stats: null,
              });
            });
          } catch (e) { /* skip failed projects */ }
        }.bind(this)));

        // 3. Fetch deployment stats per env in parallel
        await Promise.all(allEnvs.map(async function (env) {
          try {
            var sRes = await fetch(
              this._cpUrl + '/cc-ui/v1/clusters/' + encodeURIComponent(env.cluster.id) + '/deployments/stats?days=30',
              { headers: this._authHeader() }
            );
            if (sRes.ok) env.stats = await sRes.json();
          } catch (e) { /* stats optional */ }
        }.bind(this)));

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

    // ── UI ────────────────────────────────────────────────────────────────────

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
        if (self._filterStatus && e.clusterState !== self._filterStatus) return false;
        return true;
      });

      this.shadowRoot.getElementById('env-count').textContent = envs.length;

      var counts = { running: 0, stopped: 0, failed: 0, other: 0 };
      envs.forEach(function (e) {
        var s = e.clusterState;
        if (s === 'RUNNING') counts.running++;
        else if (s === 'STOPPED' || s === 'SCALE_DOWN') counts.stopped++;
        else if (s && s.indexOf('FAILED') !== -1) counts.failed++;
        else counts.other++;
      });

      this.shadowRoot.getElementById('summary-bar').innerHTML = [
        self._chipHtml(envs.length,      'Total',   '#645DF6'),
        self._chipHtml(counts.running,   'Running', '#00C2BB'),
        self._chipHtml(counts.stopped,   'Stopped', '#6b7280'),
        self._chipHtml(counts.failed,    'Failed',  '#dc2626'),
        self._chipHtml(counts.other,     'Other',   '#f57c00'),
      ].join('');

      var grid  = this.shadowRoot.getElementById('cards-grid');
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
      var cl    = env.cluster;
      var state = env.clusterState;
      var meta  = STATE_META[state] || STATE_META.UNKNOWN;
      var cloudLabel = CLOUD_ICONS[cl.cloud] || cl.cloud || '';

      var uptimePct = null, successCount = 0, failedCount = 0;
      if (env.stats && env.stats.stats) {
        successCount = env.stats.stats.successReleases || 0;
        failedCount  = env.stats.stats.failedReleases  || 0;
        var total = successCount + failedCount;
        if (total > 0) uptimePct = Math.round((successCount / total) * 100);
      }

      var uptimeHtml = '';
      if (uptimePct !== null) {
        var uColor = uptimeColor(uptimePct);
        uptimeHtml = [
          '<div class="uptime-bar-wrap">',
          '  <div class="uptime-bar-bg"><div class="uptime-bar-fill" style="width:' + uptimePct + '%;background:' + uColor + '"></div></div>',
          '  <div class="uptime-lbl"><span>Release Success (30d)</span><span style="color:' + uColor + ';font-weight:700;">' + uptimePct + '%</span></div>',
          '</div>',
        ].join('');
      }

      var metaChips = '';
      if (cloudLabel)      metaChips += '<span class="meta-chip">' + cloudLabel + '</span>';
      if (cl.isEphemeral)  metaChips += '<span class="meta-chip">Ephemeral</span>';
      if (cl.pauseReleases)metaChips += '<span class="meta-chip">⏸ Paused</span>';
      if (cl.branch)       metaChips += '<span class="meta-chip">⎇ ' + this._esc(cl.branch) + '</span>';

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
        '    <div class="stat"><div class="stat-val" style="color:#00C2BB">' + successCount + '</div><div class="stat-lbl">Success</div></div>',
        '    <div class="stat"><div class="stat-val" style="color:#dc2626">' + failedCount + '</div><div class="stat-lbl">Failed</div></div>',
        '    <div class="stat"><div class="stat-val">' + (uptimePct !== null ? uptimePct + '%' : '—') + '</div><div class="stat-lbl">Uptime</div></div>',
        '  </div>',
        uptimeHtml,
        '</div>',
      ].join('\n');
    }

    _esc(str) {
      return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    _showLoading(show) { this.shadowRoot.getElementById('loading').style.display = show ? 'block' : 'none'; }
    _showMainContent(show) { this.shadowRoot.getElementById('main-content').style.display = show ? 'block' : 'none'; }
    _showError(msg) {
      var el = this.shadowRoot.getElementById('error-box');
      el.textContent = '⚠ ' + msg;
      el.style.display = 'block';
    }
    _hideError() { this.shadowRoot.getElementById('error-box').style.display = 'none'; }
    _setRefreshBtnDisabled(d) { var b = this.shadowRoot.getElementById('refresh-btn'); if (b) b.disabled = d; }
    _updateLastRefreshed() {
      var el = this.shadowRoot.getElementById('last-refresh');
      if (el && this._lastRefreshed) el.textContent = 'Updated ' + this._lastRefreshed.toLocaleTimeString();
    }
  }

  customElements.define('health-dashboard', HealthDashboard);
})();
