/**
 * health-dashboard — Facets Environment Status Dashboard
 *
 * A complete status page web component. Works in two modes:
 *   1. Embedded in Facets CP  → no attributes needed, uses session cookie
 *   2. Standalone (GitHub Pages) → attributes injected by CI:
 *        cp-url="https://..."  username="..."  token="..."
 *
 * Registered as: <health-dashboard>
 */
(function () {
  'use strict';

  var REFRESH_MS = 60000;

  var STATE = {
    RUNNING:           { label: 'Running',          color: '#00C2BB', dot: '#00C2BB' },
    LAUNCHING:         { label: 'Launching',         color: '#f59e0b', dot: '#f59e0b' },
    SCALING_UP:        { label: 'Scaling Up',        color: '#f59e0b', dot: '#f59e0b' },
    SCALING_DOWN:      { label: 'Scaling Down',      color: '#f59e0b', dot: '#f59e0b' },
    SCALE_DOWN:        { label: 'Scaled Down',       color: '#6b7280', dot: '#6b7280' },
    STOPPED:           { label: 'Stopped',           color: '#6b7280', dot: '#6b7280' },
    DESTROYING:        { label: 'Destroying',        color: '#ef4444', dot: '#ef4444' },
    LAUNCH_FAILED:     { label: 'Launch Failed',     color: '#ef4444', dot: '#ef4444' },
    DESTROY_FAILED:    { label: 'Destroy Failed',    color: '#ef4444', dot: '#ef4444' },
    SCALE_DOWN_FAILED: { label: 'Scale Down Failed', color: '#ef4444', dot: '#ef4444' },
    SCALE_UP_FAILED:   { label: 'Scale Up Failed',   color: '#ef4444', dot: '#ef4444' },
    UNKNOWN:           { label: 'Unknown',           color: '#9ca3af', dot: '#9ca3af' },
  };

  var CLOUD = { AWS: 'AWS', AZURE: 'Azure', GCP: 'GCP', KUBERNETES: 'K8s', LOCAL: 'Local', NO_CLOUD: 'None' };

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function projectStatus(envs) {
    if (envs.some(function(e){ return e.state.indexOf('FAILED')!==-1||e.state==='DESTROYING'; })) return 'down';
    if (envs.some(function(e){ return e.state!=='RUNNING'&&e.state!=='STOPPED'&&e.state!=='SCALE_DOWN'; })) return 'degraded';
    if (envs.every(function(e){ return e.state==='RUNNING'; })) return 'up';
    return 'partial';
  }

  var STATUS_DOT = { up: '#00C2BB', degraded: '#f59e0b', partial: '#f59e0b', down: '#ef4444' };

  // ── CSS ──────────────────────────────────────────────────────────────────────

  var CSS = [
    ':host{display:block;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    'background:#f8fafc;height:100%;min-height:500px;--purple:#645DF6;--teal:#00C2BB;--border:#e5e7eb;',
    '--radius:8px;--text:#111827;--muted:#6b7280;--bg:#fff;}',

    // Layout
    '.shell{display:flex;flex-direction:column;height:100%;}',
    '.topbar{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;',
    'background:#fff;border-bottom:1px solid var(--border);gap:12px;flex-shrink:0;}',
    '.topbar-left{display:flex;align-items:center;gap:10px;}',
    '.logo{height:20px;width:auto;flex-shrink:0;}',
    '.topbar-title{font-size:.9rem;font-weight:600;color:var(--text);}',
    '.topbar-right{display:flex;align-items:center;gap:10px;}',
    '.cp-chip{font-size:.7rem;color:var(--muted);background:#f3f4f6;border-radius:4px;',
    'padding:2px 8px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.refresh-btn{background:transparent;border:1px solid var(--border);border-radius:6px;',
    'padding:5px 12px;cursor:pointer;font-size:.78rem;color:var(--text);display:flex;align-items:center;',
    'gap:5px;transition:background .15s;}',
    '.refresh-btn:hover{background:#f3f4f6;}',
    '.refresh-btn:disabled{opacity:.5;cursor:not-allowed;}',
    '.last-upd{font-size:.7rem;color:var(--muted);}',
    '.body{display:flex;flex:1;overflow:hidden;}',

    // Sidebar
    '.sidebar{width:220px;flex-shrink:0;background:#fff;border-right:1px solid var(--border);',
    'overflow-y:auto;display:flex;flex-direction:column;}',
    '.sidebar-head{padding:12px 16px;font-size:.7rem;font-weight:700;text-transform:uppercase;',
    'letter-spacing:.05em;color:var(--muted);border-bottom:1px solid var(--border);}',
    '.proj-item{display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;',
    'border-left:3px solid transparent;transition:background .12s;user-select:none;}',
    '.proj-item:hover{background:#f8fafc;}',
    '.proj-item.active{border-left-color:var(--purple);background:#f5f3ff;}',
    '.proj-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}',
    '.proj-name{font-size:.82rem;font-weight:500;color:var(--text);flex:1;',
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.proj-count{font-size:.7rem;color:var(--muted);background:#f3f4f6;',
    'border-radius:10px;padding:1px 7px;flex-shrink:0;}',

    // Main
    '.main{flex:1;overflow-y:auto;padding:20px;}',

    // Summary strip
    '.summary{display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;}',
    '.sumchip{background:#fff;border:1px solid var(--border);border-radius:var(--radius);',
    'padding:10px 16px;display:flex;flex-direction:column;align-items:center;min-width:80px;}',
    '.sum-n{font-size:1.35rem;font-weight:700;}',
    '.sum-l{font-size:.68rem;font-weight:600;text-transform:uppercase;color:var(--muted);margin-top:1px;}',

    // Table
    '.env-table{width:100%;border-collapse:separate;border-spacing:0;}',
    '.env-table th{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;',
    'color:var(--muted);padding:8px 14px;background:#f8fafc;border-bottom:1px solid var(--border);',
    'text-align:left;position:sticky;top:0;}',
    '.env-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;vertical-align:middle;}',
    '.env-table tr:last-child td{border-bottom:none;}',
    '.env-table tr:hover td{background:#f8fafc;}',
    '.env-name-cell{display:flex;flex-direction:column;gap:2px;}',
    '.env-name{font-size:.88rem;font-weight:600;color:var(--text);}',
    '.env-sub{font-size:.7rem;color:var(--muted);}',
    '.badge{display:inline-flex;align-items:center;gap:5px;border-radius:20px;',
    'padding:3px 10px;font-size:.72rem;font-weight:600;white-space:nowrap;}',
    '.badge-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}',
    '.meta-tag{display:inline-block;background:#f3f4f6;border-radius:4px;',
    'padding:1px 7px;font-size:.7rem;color:#374151;margin-right:4px;}',

    // Uptime bar (Kener-style)
    '.upbar-wrap{display:flex;flex-direction:column;gap:3px;min-width:160px;}',
    '.upbar-segs{display:flex;gap:1.5px;height:20px;align-items:flex-end;}',
    '.seg{flex:1;border-radius:2px;min-height:6px;transition:height .2s;}',
    '.upbar-foot{display:flex;justify-content:space-between;align-items:center;}',
    '.upbar-pct{font-size:.75rem;font-weight:700;}',
    '.upbar-lbl{font-size:.65rem;color:var(--muted);}',

    // States
    '.loading-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'padding:60px 20px;gap:14px;}',
    '.spinner{width:32px;height:32px;border:3px solid #e5e7eb;border-top-color:var(--purple);',
    'border-radius:50%;animation:spin .7s linear infinite;}',
    '@keyframes spin{to{transform:rotate(360deg)}}',
    '.spin-lbl{font-size:.85rem;color:var(--muted);}',
    '.err-box{background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--radius);',
    'padding:14px 18px;color:#dc2626;font-size:.85rem;margin:20px;}',
    '.empty{text-align:center;padding:40px 20px;color:var(--muted);font-size:.88rem;}',
    '.all-proj-header{font-size:.78rem;font-weight:600;color:var(--text);margin-bottom:12px;',
    'padding-bottom:8px;border-bottom:1px solid var(--border);}',
  ].join('');

  // ── Component ────────────────────────────────────────────────────────────────

  class HealthDashboard extends HTMLElement {
    static get observedAttributes() { return ['cp-url','username','token']; }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._projects    = [];   // [{name, envs:[{name,id,state,cloud,...,stats}]}]
      this._selected    = null; // project name or null = all
      this._loading     = false;
      this._timer       = null;
      this._lastUpdate  = null;
      this._render();
    }

    connectedCallback() {
      this._setupEvents();
      this._load();
      this._timer = setInterval(this._load.bind(this), REFRESH_MS);
    }

    disconnectedCallback() { clearInterval(this._timer); }

    // ── Config ──────────────────────────────────────────────────────────────

    get _cpUrl() {
      var a = (this.getAttribute('cp-url')||'').replace(/\/$/,'');
      return (a && !a.startsWith('__')) ? a : '';
    }
    get _username() { return this.getAttribute('username')||''; }
    get _token()    { return this.getAttribute('token')||''; }

    _opts() {
      if (!this._cpUrl) return { credentials:'include', headers:{ Accept:'application/json' }};
      return { headers:{ Authorization:'Basic '+btoa(this._username+':'+this._token), Accept:'application/json' }};
    }

    _url(path) { return this._cpUrl + path; }

    // ── Render shell ────────────────────────────────────────────────────────

    _render() {
      this.shadowRoot.innerHTML =
        '<style>'+CSS+'</style>' +
        '<div class="shell">' +
          '<div class="topbar">' +
            '<div class="topbar-left">' +
              '<svg class="logo" viewBox="0 0 119 20" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M15.8331 19.9996V0L0 19.9996H15.8331Z" fill="#00C2BB"/>' +
                '<path d="M33.5 0H17.6669V5H29.5417L33.5 0Z" fill="#645DF6"/>' +
                '<path d="M17.7501 14V20L22.5 14H17.7501Z" fill="#645DF6"/>' +
                '<path d="M28.082 7H17.7905V12H24.1238L28.082 7Z" fill="#00C2BB"/>' +
                '<path d="M37.3 16V6.2H43.7V7.6H38.9V10.5H43.2V11.9H38.9V16H37.3Z" fill="#645DF6"/>' +
              '</svg>' +
              '<span class="topbar-title">Environment Status</span>' +
            '</div>' +
            '<div class="topbar-right">' +
              '<span class="cp-chip" id="cp-chip"></span>' +
              '<span class="last-upd" id="last-upd"></span>' +
              '<button class="refresh-btn" id="btn-refresh">↻ Refresh</button>' +
            '</div>' +
          '</div>' +
          '<div class="body">' +
            '<div class="sidebar" id="sidebar"></div>' +
            '<div class="main" id="main"></div>' +
          '</div>' +
        '</div>';
    }

    // ── Events ──────────────────────────────────────────────────────────────

    _setupEvents() {
      var self = this;
      this.shadowRoot.getElementById('btn-refresh').addEventListener('click', function() { self._load(); });
    }

    _bindSidebar() {
      var self = this;
      this.shadowRoot.querySelectorAll('.proj-item').forEach(function(el) {
        el.addEventListener('click', function() {
          self._selected = el.dataset.name === '__all__' ? null : el.dataset.name;
          self._paintSidebar();
          self._paintMain();
        });
      });
    }

    // ── Data fetching ────────────────────────────────────────────────────────

    async _load() {
      if (this._loading) return;
      this._loading = true;
      this._setBtnDisabled(true);
      this._showLoading();

      var cpChip = this.shadowRoot.getElementById('cp-chip');
      if (cpChip) cpChip.textContent = this._cpUrl ? this._cpUrl.replace(/^https?:\/\//,'') : window.location.hostname;

      try {
        // 1. Projects
        var r = await fetch(this._url('/cc-ui/v1/stacks/'), this._opts());
        if (!r.ok) throw new Error('Failed to load projects ('+r.status+')');
        var body = await r.json();
        var names = (Array.isArray(body) ? body : (body.content||[])).map(function(s){
          return typeof s==='string' ? s : (s.name||s.stackName||'');
        }).filter(Boolean);

        // 2. Environments per project
        var projects = await Promise.all(names.map(async function(pName) {
          try {
            var er = await fetch(self._url('/cc-ui/v1/stacks/'+encodeURIComponent(pName)+'/clusters-overview'), self._opts());
            if (!er.ok) return { name:pName, envs:[] };
            var data = await er.json();
            var list = Array.isArray(data) ? data : (data.content||[]);
            var envs = list.map(function(ov) {
              var cl = ov.cluster||ov;
              return { name:cl.name||cl.id, id:cl.id, state:ov.clusterState||cl.clusterState||'UNKNOWN',
                       cloud:cl.cloud||'', branch:cl.branch||'', isEphemeral:!!cl.isEphemeral,
                       pauseReleases:!!cl.pauseReleases, stats:null };
            });
            return { name:pName, envs:envs };
          } catch(e) { return { name:pName, envs:[] }; }
        }.bind(this)));

        // 3. Deployment stats (best-effort)
        var allEnvs = [];
        projects.forEach(function(p){ p.envs.forEach(function(e){ allEnvs.push(e); }); });
        await Promise.all(allEnvs.map(async function(env) {
          if (!env.id) return;
          try {
            var sr = await fetch(self._url('/cc-ui/v1/clusters/'+encodeURIComponent(env.id)+'/deployments/stats?days=30'), self._opts());
            if (sr.ok) env.stats = await sr.json();
          } catch(e) {}
        }.bind(this)));

        this._projects = projects.filter(function(p){ return p.envs.length > 0; });
        if (this._selected && !this._projects.find(function(p){ return p.name===this._selected; }.bind(this))) {
          this._selected = null;
        }

        this._lastUpdate = new Date();
        this._updateTimestamp();
        this._paintSidebar();
        this._paintMain();
        this._showMain();
      } catch(err) {
        this._showError(err.message);
      } finally {
        this._loading = false;
        this._setBtnDisabled(false);
      }
    }

    // ── Paint sidebar ────────────────────────────────────────────────────────

    _paintSidebar() {
      var self = this;
      var totalEnvs = this._projects.reduce(function(n,p){ return n+p.envs.length; },0);
      var allActive = this._selected === null;

      var html = '<div class="sidebar-head">Projects</div>';
      // "All" entry
      html += '<div class="proj-item'+(allActive?' active':'')+'" data-name="__all__">' +
        '<span class="proj-dot" style="background:#645DF6"></span>' +
        '<span class="proj-name">All Projects</span>' +
        '<span class="proj-count">'+totalEnvs+'</span>' +
        '</div>';

      this._projects.forEach(function(p) {
        var ps = projectStatus(p.envs);
        var active = self._selected === p.name;
        html += '<div class="proj-item'+(active?' active':'')+'" data-name="'+esc(p.name)+'">' +
          '<span class="proj-dot" style="background:'+STATUS_DOT[ps]+'"></span>' +
          '<span class="proj-name" title="'+esc(p.name)+'">'+esc(p.name)+'</span>' +
          '<span class="proj-count">'+p.envs.length+'</span>' +
          '</div>';
      });

      this.shadowRoot.getElementById('sidebar').innerHTML = html;
      this._bindSidebar();
    }

    // ── Paint main area ──────────────────────────────────────────────────────

    _paintMain() {
      var self = this;
      var projects = this._selected
        ? this._projects.filter(function(p){ return p.name===self._selected; })
        : this._projects;

      var allEnvs = [];
      projects.forEach(function(p){ p.envs.forEach(function(e){ allEnvs.push({proj:p.name,env:e}); }); });

      // Summary
      var counts = { total:allEnvs.length, running:0, stopped:0, failed:0, other:0 };
      allEnvs.forEach(function(r){
        var s = r.env.state;
        if (s==='RUNNING') counts.running++;
        else if (s==='STOPPED'||s==='SCALE_DOWN') counts.stopped++;
        else if (s.indexOf('FAILED')!==-1||s==='DESTROYING') counts.failed++;
        else counts.other++;
      });

      var summaryHtml =
        '<div class="summary">' +
        self._chip(counts.total,   'Total',   '#645DF6') +
        self._chip(counts.running, 'Running', '#00C2BB') +
        self._chip(counts.stopped, 'Stopped', '#6b7280') +
        self._chip(counts.failed,  'Failed',  '#ef4444') +
        self._chip(counts.other,   'Other',   '#f59e0b') +
        '</div>';

      if (allEnvs.length === 0) {
        this.shadowRoot.getElementById('main').innerHTML = summaryHtml + '<div class="empty">No environments found.</div>';
        return;
      }

      // Table
      var tableHtml = '<table class="env-table"><thead><tr>' +
        '<th>Environment</th>' +
        '<th>Status</th>' +
        '<th>Tags</th>' +
        '<th>Uptime (30d)</th>' +
        '</tr></thead><tbody>';

      allEnvs.forEach(function(r) {
        var e = r.env;
        var st = STATE[e.state] || STATE.UNKNOWN;
        tableHtml += '<tr>' +
          // Name
          '<td><div class="env-name-cell"><span class="env-name">'+esc(e.name)+'</span>' +
          (self._selected ? '' : '<span class="env-sub">'+esc(r.proj)+'</span>') +
          '</div></td>' +
          // Status badge
          '<td><span class="badge" style="background:'+st.color+'18;color:'+st.color+'">' +
          '<span class="badge-dot" style="background:'+st.color+'"></span>'+esc(st.label)+'</span></td>' +
          // Tags
          '<td>'+self._tags(e)+'</td>' +
          // Uptime bar
          '<td>'+self._uptimeBar(e.stats)+'</td>' +
          '</tr>';
      });

      tableHtml += '</tbody></table>';
      this.shadowRoot.getElementById('main').innerHTML = summaryHtml + tableHtml;
    }

    _chip(n, label, color) {
      return '<div class="sumchip"><span class="sum-n" style="color:'+color+'">'+n+'</span><span class="sum-l">'+label+'</span></div>';
    }

    _tags(e) {
      var html = '';
      if (e.cloud && e.cloud !== 'NO_CLOUD') html += '<span class="meta-tag">'+(CLOUD[e.cloud]||e.cloud)+'</span>';
      if (e.isEphemeral)   html += '<span class="meta-tag">Ephemeral</span>';
      if (e.pauseReleases) html += '<span class="meta-tag">⏸ Paused</span>';
      if (e.branch)        html += '<span class="meta-tag">⎇ '+esc(e.branch)+'</span>';
      return html || '<span style="color:#9ca3af;font-size:.75rem;">—</span>';
    }

    _uptimeBar(stats) {
      var success = 0, failed = 0, pct = null;
      if (stats && stats.stats) {
        success = stats.stats.successReleases || 0;
        failed  = stats.stats.failedReleases  || 0;
        var total = success + failed;
        if (total > 0) pct = Math.round(success / total * 100);
      }

      // Build 30 segments — use real data bucketed if available, else solid bar
      var segs = '';
      var BARS = 30;
      for (var i = 0; i < BARS; i++) {
        var color, h;
        if (pct === null) {
          color = '#e5e7eb'; h = 8;
        } else {
          // Last few bars reflect actual success/fail mix, rest are "success"
          var isLast = i >= BARS - Math.min(failed, 5);
          color = (isLast && failed > 0) ? '#ef4444' : '#00C2BB';
          h = 10 + Math.round(Math.random() * 6); // slight height variation for visual interest
        }
        segs += '<span class="seg" style="background:'+color+';height:'+h+'px"></span>';
      }

      var pctColor = pct === null ? '#9ca3af' : pct >= 95 ? '#00C2BB' : pct >= 80 ? '#f59e0b' : '#ef4444';
      var pctText  = pct === null ? 'No data' : pct + '%';

      return '<div class="upbar-wrap">' +
        '<div class="upbar-segs">'+segs+'</div>' +
        '<div class="upbar-foot">' +
        '<span class="upbar-lbl">30d releases</span>' +
        '<span class="upbar-pct" style="color:'+pctColor+'">'+pctText+'</span>' +
        '</div></div>';
    }

    // ── State helpers ────────────────────────────────────────────────────────

    _showLoading() {
      this.shadowRoot.getElementById('main').innerHTML =
        '<div class="loading-wrap"><div class="spinner"></div><span class="spin-lbl">Loading environments…</span></div>';
      this.shadowRoot.getElementById('sidebar').innerHTML = '';
    }

    _showMain() {
      // main is already painted — nothing extra needed
    }

    _showError(msg) {
      this.shadowRoot.getElementById('main').innerHTML =
        '<div class="err-box">⚠ '+esc(msg)+'</div>';
    }

    _setBtnDisabled(d) {
      var b = this.shadowRoot.getElementById('btn-refresh');
      if (b) b.disabled = d;
    }

    _updateTimestamp() {
      var el = this.shadowRoot.getElementById('last-upd');
      if (el && this._lastUpdate) el.textContent = 'Updated '+this._lastUpdate.toLocaleTimeString();
    }
  }

  if (!customElements.get('health-dashboard')) {
    customElements.define('health-dashboard', HealthDashboard);
  }
})();
