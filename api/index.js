const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const app = express();

// ==================== CONFIGURATION ====================
// !!! CHANGE THIS PASSWORD BEFORE DEPLOYING !!!
const ADMIN_PASSWORD = 'YourStrongPassword123'; // CHANGE THIS!
// =======================================================

const SESSION_SECRET = 'veribridge-secret-2024';

// ==================== MIDDLEWARE ====================
app.use(cors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(express.json());
app.use(cookieParser());

// Add request logging for debugging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// ==================== DATA STORAGE ====================
let links = new Map();
let nextId = 1;

function generateCode() {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// ==================== AUTH MIDDLEWARE ====================
function isAuthenticated(req, res, next) {
    const token = req.cookies.admin_token;
    console.log(`[Auth] Token present: ${!!token}`);
    
    if (token === SESSION_SECRET) {
        console.log('[Auth] Authentication successful');
        next();
    } else {
        console.log('[Auth] Authentication failed');
        res.status(401).json({ error: 'Unauthorized', success: false });
    }
}

// ==================== PUBLIC API ROUTES ====================

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', linksCount: links.size, timestamp: Date.now() });
});

// Generate shareable link
app.post('/api/generate', (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'No URL provided', success: false });
    }
    
    const code = generateCode();
    
    links.set(code, {
        id: nextId++,
        code: code,
        targetUrl: url,
        createdAt: Date.now(),
        clicks: 0,
        lastAccessed: null
    });
    
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const baseUrl = `${protocol}://${host}`;
    const shareableLink = `${baseUrl}/verify.html?code=${code}`;
    
    res.json({
        success: true,
        shareableLink: shareableLink,
        code: code
    });
});

// Get link data for verification page
app.get('/api/link/:code', (req, res) => {
    const { code } = req.params;
    const linkData = links.get(code);
    
    if (!linkData) {
        return res.status(404).json({ error: 'Link not found', success: false });
    }
    
    linkData.clicks++;
    linkData.lastAccessed = Date.now();
    links.set(code, linkData);
    
    res.json({
        success: true,
        targetUrl: linkData.targetUrl
    });
});

// ==================== ADMIN API (Protected) ====================

// Get all links
app.get('/admin/api/links', isAuthenticated, (req, res) => {
    const { search = '' } = req.query;
    
    let allLinks = Array.from(links.values()).sort((a, b) => b.createdAt - a.createdAt);
    
    if (search) {
        const searchLower = search.toLowerCase();
        allLinks = allLinks.filter(link => 
            link.targetUrl.toLowerCase().includes(searchLower) || 
            link.code.toLowerCase().includes(searchLower)
        );
    }
    
    res.json({ 
        success: true, 
        links: allLinks,
        total: links.size,
        filtered: allLinks.length
    });
});

// Get single link
app.get('/admin/api/links/:code', isAuthenticated, (req, res) => {
    const link = links.get(req.params.code);
    
    if (link) {
        res.json({ success: true, link });
    } else {
        res.status(404).json({ success: false, error: 'Link not found' });
    }
});

// Create new link
app.post('/admin/api/links', isAuthenticated, (req, res) => {
    const { targetUrl } = req.body;
    
    if (!targetUrl) {
        return res.status(400).json({ error: 'No URL provided', success: false });
    }
    
    const code = generateCode();
    
    links.set(code, {
        id: nextId++,
        code: code,
        targetUrl: targetUrl,
        createdAt: Date.now(),
        clicks: 0,
        lastAccessed: null
    });
    
    res.json({ 
        success: true, 
        link: links.get(code),
        shareableLink: `https://${req.headers.host}/verify.html?code=${code}`
    });
});

// Update link
app.put('/admin/api/links/:code', isAuthenticated, (req, res) => {
    const { targetUrl } = req.body;
    const link = links.get(req.params.code);
    
    if (link) {
        link.targetUrl = targetUrl;
        link.updatedAt = Date.now();
        links.set(req.params.code, link);
        res.json({ success: true, link });
    } else {
        res.status(404).json({ success: false, error: 'Link not found' });
    }
});

// Delete link
app.delete('/admin/api/links/:code', isAuthenticated, (req, res) => {
    const deleted = links.delete(req.params.code);
    if (deleted) {
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, error: 'Link not found' });
    }
});

// Get statistics
app.get('/admin/api/stats', isAuthenticated, (req, res) => {
    const allLinks = Array.from(links.values());
    const totalClicks = allLinks.reduce((sum, link) => sum + (link.clicks || 0), 0);
    const averageClicks = allLinks.length > 0 ? totalClicks / allLinks.length : 0;
    
    res.json({
        success: true,
        stats: {
            totalLinks: links.size,
            totalClicks: totalClicks,
            averageClicks: averageClicks.toFixed(2),
            lastCreated: allLinks[0]?.createdAt || null
        }
    });
});

// Admin login API
app.post('/admin/api/login', (req, res) => {
    const { password } = req.body;
    console.log(`[Login] Attempt with password: ${password ? '***' : 'empty'}`);
    console.log(`[Login] Expected password: ${ADMIN_PASSWORD}`);
    
    if (password === ADMIN_PASSWORD) {
        console.log('[Login] Password correct, setting cookie');
        res.cookie('admin_token', SESSION_SECRET, { 
            httpOnly: true, 
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: 'lax',
            path: '/',
            secure: false // Set to true if using HTTPS only
        });
        res.json({ success: true });
    } else {
        console.log('[Login] Password incorrect');
        res.status(401).json({ success: false, error: 'Invalid password' });
    }
});

// Admin logout API
app.post('/admin/api/logout', (req, res) => {
    res.clearCookie('admin_token', { path: '/' });
    res.json({ success: true });
});

// ==================== PROTECTED ADMIN DASHBOARD ====================
app.get('/admin/dashboard', isAuthenticated, (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Dashboard - Manage Links</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            background: #0a0f1e;
            color: white;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            padding: 20px;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            flex-wrap: wrap;
            gap: 15px;
            padding-bottom: 20px;
            border-bottom: 1px solid rgba(0, 255, 255, 0.2);
        }
        
        h1 {
            color: #00ffff;
            font-size: 28px;
        }
        
        .logout-btn {
            background: #ff5555;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            color: white;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
        }
        
        .logout-btn:hover {
            background: #ff3333;
        }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: rgba(0, 0, 0, 0.4);
            border: 1px solid rgba(0, 255, 255, 0.3);
            border-radius: 15px;
            padding: 20px;
            text-align: center;
        }
        
        .stat-card:hover {
            border-color: #00ffff;
        }
        
        .stat-number {
            font-size: 36px;
            font-weight: bold;
            color: #00ffff;
        }
        
        .stat-label {
            color: #9ab3cc;
            margin-top: 5px;
            font-size: 14px;
        }
        
        .controls {
            display: flex;
            gap: 15px;
            margin-bottom: 20px;
            flex-wrap: wrap;
            align-items: center;
        }
        
        .search-box {
            flex: 1;
            display: flex;
            gap: 10px;
        }
        
        .search-box input {
            flex: 1;
            background: rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(0, 255, 255, 0.3);
            padding: 12px 15px;
            border-radius: 10px;
            color: white;
            font-size: 14px;
        }
        
        .search-box input:focus {
            outline: none;
            border-color: #00ffff;
        }
        
        .search-box button, .add-link-btn, .refresh-btn {
            background: #2c5a7a;
            border: none;
            padding: 12px 20px;
            border-radius: 10px;
            color: white;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .add-link-btn {
            background: linear-gradient(135deg, #00aa00, #008800);
        }
        
        .add-link-btn:hover, .search-box button:hover, .refresh-btn:hover {
            transform: scale(1.02);
            opacity: 0.9;
        }
        
        .table-wrapper {
            overflow-x: auto;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 15px;
            border: 1px solid rgba(0, 255, 255, 0.2);
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
        }
        
        th, td {
            padding: 14px 12px;
            text-align: left;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        th {
            background: rgba(0, 255, 255, 0.1);
            color: #00ffff;
            font-weight: 600;
        }
        
        tr:hover {
            background: rgba(0, 255, 255, 0.05);
        }
        
        .code-cell {
            font-family: monospace;
            font-size: 12px;
            color: #00ffff;
        }
        
        .url-cell {
            max-width: 400px;
            overflow: hidden;
            text-overflow: ellipsis;
            word-break: break-all;
        }
        
        .badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: bold;
            background: #00aa00;
            color: white;
        }
        
        .action-btns {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        
        .edit-btn, .copy-btn, .delete-btn {
            border: none;
            padding: 5px 12px;
            border-radius: 5px;
            color: white;
            cursor: pointer;
            font-size: 12px;
        }
        
        .edit-btn { background: #2c5a7a; }
        .edit-btn:hover { background: #1e3a5a; }
        .copy-btn { background: #555555; }
        .copy-btn:hover { background: #666666; }
        .delete-btn { background: #ff5555; }
        .delete-btn:hover { background: #ff3333; }
        
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        
        .modal.active {
            display: flex;
        }
        
        .modal-content {
            background: #1a1a2e;
            padding: 30px;
            border-radius: 20px;
            width: 90%;
            max-width: 500px;
            border: 1px solid #00ffff;
        }
        
        .modal-content h3 {
            margin-bottom: 20px;
            color: #00ffff;
        }
        
        .modal-content input, .modal-content textarea {
            width: 100%;
            padding: 12px;
            margin: 10px 0;
            background: rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(0, 255, 255, 0.3);
            border-radius: 10px;
            color: white;
            font-size: 14px;
        }
        
        .modal-content textarea {
            resize: vertical;
            min-height: 80px;
            font-family: monospace;
        }
        
        .modal-buttons {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }
        
        .save-btn {
            flex: 1;
            background: #00aa00;
            border: none;
            padding: 12px;
            border-radius: 10px;
            color: white;
            font-weight: bold;
            cursor: pointer;
        }
        
        .cancel-btn {
            flex: 1;
            background: #555555;
            border: none;
            padding: 12px;
            border-radius: 10px;
            color: white;
            cursor: pointer;
        }
        
        .toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #00aa00;
            color: white;
            padding: 12px 20px;
            border-radius: 10px;
            z-index: 1001;
            animation: slideIn 0.3s ease-out;
        }
        
        .toast.error {
            background: #ff5555;
        }
        
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        .loading {
            text-align: center;
            padding: 40px;
            color: #9ab3cc;
        }
        
        .empty-state {
            text-align: center;
            padding: 60px;
            color: #9ab3cc;
        }
        
        @media (max-width: 768px) {
            th, td { font-size: 12px; padding: 10px 8px; }
            .action-btns { flex-direction: column; }
            .controls { flex-direction: column; }
            .search-box { width: 100%; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 VeriBridge Admin Dashboard</h1>
            <button class="logout-btn" onclick="logout()">🚪 Logout</button>
        </div>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-number" id="totalLinks">0</div>
                <div class="stat-label">Total Links</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="totalClicks">0</div>
                <div class="stat-label">Total Clicks</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="avgClicks">0</div>
                <div class="stat-label">Avg Clicks/Link</div>
            </div>
        </div>
        
        <div class="controls">
            <div class="search-box">
                <input type="text" id="searchInput" placeholder="Search by URL or code...">
                <button onclick="loadLinks()">🔍 Search</button>
                <button onclick="clearSearch()">🗑️ Clear</button>
            </div>
            <button class="add-link-btn" onclick="openAddModal()">➕ Add New Link</button>
            <button class="refresh-btn" onclick="loadLinks()">🔄 Refresh</button>
        </div>
        
        <div class="table-wrapper">
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Code</th>
                        <th>Target URL</th>
                        <th>Status</th>
                        <th>Clicks</th>
                        <th>Created</th>
                        <th>Last Accessed</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="tableBody">
                    <tr><td colspan="8" class="loading">Loading links...</td></tr>
                </tbody>
            </table>
        </div>
    </div>
    
    <div id="editModal" class="modal">
        <div class="modal-content">
            <h3>✏️ Edit Link</h3>
            <input type="text" id="editCode" readonly placeholder="Link Code">
            <textarea id="editUrl" placeholder="Target URL"></textarea>
            <div class="modal-buttons">
                <button class="save-btn" onclick="saveEdit()">💾 Save Changes</button>
                <button class="cancel-btn" onclick="closeEditModal()">Cancel</button>
            </div>
        </div>
    </div>
    
    <div id="addModal" class="modal">
        <div class="modal-content">
            <h3>➕ Add New Link</h3>
            <textarea id="addUrl" placeholder="Enter target URL (e.g., https://roblox.com.ge)"></textarea>
            <div class="modal-buttons">
                <button class="save-btn" onclick="createLink()">✨ Create Link</button>
                <button class="cancel-btn" onclick="closeAddModal()">Cancel</button>
            </div>
        </div>
    </div>
    
    <div id="viewModal" class="modal">
        <div class="modal-content">
            <h3>🔗 Shareable Link</h3>
            <input type="text" id="viewLinkCode" readonly>
            <div class="modal-buttons">
                <button class="save-btn" onclick="copyShareableLink()">📋 Copy Link</button>
                <button class="cancel-btn" onclick="closeViewModal()">Close</button>
            </div>
        </div>
    </div>

    <script>
        let currentLinks = [];
        let currentEditCode = null;
        let searchTimeout = null;
        
        async function loadLinks() {
            const search = document.getElementById('searchInput').value;
            const url = search ? \`/admin/api/links?search=\${encodeURIComponent(search)}\` : '/admin/api/links';
            
            try {
                const res = await fetch(url);
                if (res.status === 401) {
                    window.location.href = '/admin';
                    return;
                }
                const data = await res.json();
                if (data.success) {
                    currentLinks = data.links;
                    renderTable();
                    loadStats();
                }
            } catch (err) {
                console.error('Error loading links:', err);
                showToast('Failed to load links', 'error');
            }
        }
        
        async function loadStats() {
            try {
                const res = await fetch('/admin/api/stats');
                if (res.status === 401) {
                    window.location.href = '/admin';
                    return;
                }
                const data = await res.json();
                if (data.success) {
                    document.getElementById('totalLinks').innerText = data.stats.totalLinks;
                    document.getElementById('totalClicks').innerText = data.stats.totalClicks;
                    document.getElementById('avgClicks').innerText = data.stats.averageClicks;
                }
            } catch (err) {
                console.error('Error loading stats:', err);
            }
        }
        
        function formatDate(timestamp) {
            if (!timestamp) return 'Never';
            return new Date(timestamp).toLocaleString();
        }
        
        function renderTable() {
            const tbody = document.getElementById('tableBody');
            
            if (currentLinks.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No links found. Create your first link!</td></tr>';
                return;
            }
            
            tbody.innerHTML = currentLinks.map(link => \`
                <tr>
                    <td>\${link.id}</td>
                    <td class="code-cell">\${link.code}</td>
                    <td class="url-cell" title="\${link.targetUrl}">\${link.targetUrl.substring(0, 60)}\${link.targetUrl.length > 60 ? '...' : ''}</td>
                    <td><span class="badge">🔒 Never Expire</span></td>
                    <td>\${link.clicks || 0}</td>
                    <td>\${formatDate(link.createdAt)}</td>
                    <td>\${formatDate(link.lastAccessed)}</td>
                    <td class="action-btns">
                        <button class="copy-btn" onclick="viewLink('\${link.code}')">🔗 Copy</button>
                        <button class="edit-btn" onclick="openEdit('\${link.code}')">✏️ Edit</button>
                        <button class="delete-btn" onclick="deleteLink('\${link.code}')">🗑️ Delete</button>
                    </td>
                </tr>
            \`).join('');
        }
        
        function viewLink(code) {
            const baseUrl = window.location.origin;
            const shareableLink = \`\${baseUrl}/verify.html?code=\${code}\`;
            document.getElementById('viewLinkCode').value = shareableLink;
            document.getElementById('viewModal').classList.add('active');
        }
        
        function copyShareableLink() {
            const input = document.getElementById('viewLinkCode');
            input.select();
            document.execCommand('copy');
            showToast('✅ Shareable link copied to clipboard!');
            closeViewModal();
        }
        
        function openEdit(code) {
            const link = currentLinks.find(l => l.code === code);
            if (link) {
                currentEditCode = code;
                document.getElementById('editCode').value = code;
                document.getElementById('editUrl').value = link.targetUrl;
                document.getElementById('editModal').classList.add('active');
            }
        }
        
        async function saveEdit() {
            const newUrl = document.getElementById('editUrl').value.trim();
            if (!newUrl) {
                showToast('Please enter a URL', 'error');
                return;
            }
            
            try {
                const res = await fetch(\`/admin/api/links/\${currentEditCode}\`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetUrl: newUrl })
                });
                if (res.ok) {
                    closeEditModal();
                    loadLinks();
                    showToast('✅ Link updated successfully!');
                } else {
                    showToast('Failed to update link', 'error');
                }
            } catch (err) {
                showToast('Error updating link', 'error');
            }
        }
        
        function openAddModal() {
            document.getElementById('addUrl').value = '';
            document.getElementById('addModal').classList.add('active');
        }
        
        async function createLink() {
            const url = document.getElementById('addUrl').value.trim();
            if (!url) {
                showToast('Please enter a URL', 'error');
                return;
            }
            
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                showToast('URL must start with http:// or https://', 'error');
                return;
            }
            
            try {
                const res = await fetch('/admin/api/links', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetUrl: url })
                });
                if (res.ok) {
                    closeAddModal();
                    loadLinks();
                    showToast('✅ New link created successfully!');
                } else {
                    showToast('Failed to create link', 'error');
                }
            } catch (err) {
                showToast('Error creating link', 'error');
            }
        }
        
        async function deleteLink(code) {
            if (confirm('Are you sure you want to delete this link? This action cannot be undone.')) {
                try {
                    const res = await fetch(\`/admin/api/links/\${code}\`, { method: 'DELETE' });
                    if (res.ok) {
                        loadLinks();
                        showToast('✅ Link deleted successfully!');
                    } else {
                        showToast('Failed to delete link', 'error');
                    }
                } catch (err) {
                    showToast('Error deleting link', 'error');
                }
            }
        }
        
        function closeEditModal() {
            document.getElementById('editModal').classList.remove('active');
        }
        
        function closeAddModal() {
            document.getElementById('addModal').classList.remove('active');
        }
        
        function closeViewModal() {
            document.getElementById('viewModal').classList.remove('active');
        }
        
        function clearSearch() {
            document.getElementById('searchInput').value = '';
            loadLinks();
        }
        
        async function logout() {
            await fetch('/admin/api/logout', { method: 'POST' });
            window.location.href = '/admin';
        }
        
        function showToast(message, type = 'success') {
            const toast = document.createElement('div');
            toast.className = \`toast \${type}\`;
            toast.innerText = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }
        
        document.getElementById('searchInput').addEventListener('input', () => {
            if (searchTimeout) clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => loadLinks(), 500);
        });
        
        loadLinks();
        setInterval(loadLinks, 30000);
    </script>
</body>
</html>
    `);
});

// ==================== ADMIN LOGIN PAGE ====================
app.get('/admin', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Login</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{min-height:100vh;background:linear-gradient(135deg,#0a0f1e 0%,#0a1a2f 50%,#0b2b3b 100%);font-family:Arial,sans-serif}
        .container{display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}
        .login-box{background:rgba(0,0,0,0.5);backdrop-filter:blur(10px);padding:40px;border-radius:20px;border:1px solid rgba(0,255,255,0.3);width:100%;max-width:400px}
        h1{color:white;text-align:center;margin-bottom:30px}
        input{width:100%;padding:12px;margin:10px 0;background:rgba(0,0,0,0.5);border:1px solid rgba(0,255,255,0.3);border-radius:10px;color:white;font-size:16px}
        button{width:100%;padding:12px;background:linear-gradient(95deg,#2c5a7a,#1e3a5a);border:none;border-radius:10px;color:white;font-weight:bold;cursor:pointer;font-size:16px}
        button:hover{opacity:0.9}
        .error{color:#ff5555;text-align:center;margin-top:10px}
    </style>
</head>
<body>
    <div class="container">
        <div class="login-box">
            <h1>🔐 Admin Login</h1>
            <input type="password" id="password" placeholder="Enter admin password">
            <button onclick="login()">Login</button>
            <div id="error" class="error"></div>
        </div>
    </div>
    <script>
        async function login() {
            const password = document.getElementById('password').value;
            const errorDiv = document.getElementById('error');
            if (!password) {
                errorDiv.innerText = 'Please enter password';
                return;
            }
            try {
                const res = await fetch('/admin/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });
                const data = await res.json();
                if (data.success) {
                    window.location.href = '/admin/dashboard';
                } else {
                    errorDiv.innerText = data.error || 'Invalid password';
                }
            } catch (err) {
                console.error('Login error:', err);
                errorDiv.innerText = 'Network error - check console';
            }
        }
        document.getElementById('password').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') login();
        });
    </script>
</body>
</html>
    `);
});

// ==================== GENERATOR PAGE ====================
app.get('/gen', (req, res) => {
    res.sendFile('/public/gen/index.html', { root: '.' });
});

// ==================== VERIFICATION PAGE ====================
app.get('/verify.html', (req, res) => {
    res.sendFile('/public/verify.html', { root: '.' });
});

module.exports = app;
