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
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// ==================== DATA STORAGE (In-memory) ====================
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

// ==================== API ROUTES ====================

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

// Get link data
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
    const allLinks = Array.from(links.values()).sort((a, b) => b.createdAt - a.createdAt);
    res.json({ success: true, links: allLinks });
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

// Admin login API
app.post('/admin/api/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.cookie('admin_token', SESSION_SECRET, { 
            httpOnly: true, 
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: 'lax',
            path: '/'
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

// ==================== PROTECTED ADMIN DASHBOARD (Not a static file!) ====================
app.get('/admin/dashboard', isAuthenticated, (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Dashboard</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:#0a0f1e;color:white;font-family:Arial,sans-serif;padding:20px}
        .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:30px;flex-wrap:wrap;gap:15px}
        h1{color:#00ffff}
        .logout-btn{background:#ff5555;border:none;padding:10px 20px;border-radius:10px;color:white;cursor:pointer}
        .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin-bottom:30px}
        .stat-card{background:rgba(0,0,0,0.3);border:1px solid rgba(0,255,255,0.3);border-radius:15px;padding:20px;text-align:center}
        .stat-number{font-size:36px;font-weight:bold;color:#00ffff}
        .stat-label{color:#9ab3cc;margin-top:5px}
        .filters{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap}
        .filters input{flex:1;background:rgba(0,0,0,0.5);border:1px solid rgba(0,255,255,0.3);padding:10px 15px;border-radius:10px;color:white}
        table{width:100%;border-collapse:collapse;background:rgba(0,0,0,0.3);border-radius:15px;overflow:hidden}
        th,td{padding:12px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.1)}
        th{background:rgba(0,255,255,0.1);color:#00ffff}
        tr:hover{background:rgba(0,255,255,0.05)}
        .edit-btn{background:#2c5a7a;border:none;padding:5px 10px;border-radius:5px;color:white;cursor:pointer;margin-right:5px}
        .delete-btn{background:#ff5555;border:none;padding:5px 10px;border-radius:5px;color:white;cursor:pointer}
        .modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);justify-content:center;align-items:center;z-index:1000}
        .modal-content{background:#1a1a2e;padding:30px;border-radius:20px;width:90%;max-width:500px;border:1px solid #00ffff}
        .modal-content input{width:100%;padding:10px;margin:10px 0;background:rgba(0,0,0,0.5);border:1px solid rgba(0,255,255,0.3);border-radius:10px;color:white}
        .modal-content button{padding:10px 20px;margin:5px;border:none;border-radius:10px;cursor:pointer}
        .save-btn{background:#00ffff;color:black}
        .cancel-btn{background:#333;color:white}
        .badge{display:inline-block;padding:3px 8px;border-radius:20px;font-size:12px;background:#00aa00;color:white}
        @media(max-width:768px){th,td{font-size:12px;padding:8px}}
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 Admin Dashboard</h1>
        <button class="logout-btn" onclick="logout()">Logout</button>
    </div>
    
    <div class="stats">
        <div class="stat-card"><div class="stat-number" id="totalLinks">0</div><div class="stat-label">Total Links</div></div>
        <div class="stat-card"><div class="stat-number" id="totalClicks">0</div><div class="stat-label">Total Clicks</div></div>
    </div>
    
    <div class="filters">
        <input type="text" id="searchInput" placeholder="Search by URL or code...">
    </div>
    
    <div style="overflow-x:auto">
        <table>
            <thead>
                <tr><th>Code</th><th>Target URL</th><th>Status</th><th>Clicks</th><th>Created</th><th>Actions</th></tr>
            </thead>
            <tbody id="tableBody"></tbody>
        </table>
    </div>
    
    <div id="editModal" class="modal">
        <div class="modal-content">
            <h3>✏️ Edit Link</h3>
            <input type="text" id="editCode" readonly>
            <input type="text" id="editUrl" placeholder="New URL">
            <div style="display:flex;gap:10px;margin-top:15px">
                <button class="save-btn" onclick="saveEdit()">Save</button>
                <button class="cancel-btn" onclick="closeModal()">Cancel</button>
            </div>
        </div>
    </div>
    
    <script>
        let currentLinks = [];
        let currentEditCode = null;
        
        async function loadLinks() {
            try {
                const res = await fetch('/admin/api/links');
                if (res.status === 401) {
                    window.location.href = '/admin';
                    return;
                }
                const data = await res.json();
                if (data.success) {
                    currentLinks = data.links;
                    document.getElementById('totalLinks').innerText = currentLinks.length;
                    document.getElementById('totalClicks').innerText = currentLinks.reduce((sum, l) => sum + (l.clicks || 0), 0);
                    renderTable();
                }
            } catch (err) {
                console.error('Error loading links:', err);
            }
        }
        
        function renderTable() {
            const search = document.getElementById('searchInput').value.toLowerCase();
            let filtered = currentLinks.filter(l => 
                l.targetUrl.toLowerCase().includes(search) || 
                l.code.toLowerCase().includes(search)
            );
            
            const tbody = document.getElementById('tableBody');
            if (filtered.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">No links found</td></tr>';
                return;
            }
            
            tbody.innerHTML = filtered.map(link => \`
                <tr>
                    <td><code>\${link.code}</code></td>
                    <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">\${link.targetUrl}</td>
                    <td><span class="badge">🔒 Never Expire</span></td>
                    <td>\${link.clicks || 0}</td>
                    <td>\${new Date(link.createdAt).toLocaleDateString()}</td>
                    <td>
                        <button class="edit-btn" onclick="openEdit('\${link.code}')">Edit</button>
                        <button class="delete-btn" onclick="deleteLink('\${link.code}')">Delete</button>
                    </td>
                </tr>
            \`).join('');
        }
        
        function openEdit(code) {
            const link = currentLinks.find(l => l.code === code);
            if (link) {
                currentEditCode = code;
                document.getElementById('editCode').value = code;
                document.getElementById('editUrl').value = link.targetUrl;
                document.getElementById('editModal').style.display = 'flex';
            }
        }
        
        async function saveEdit() {
            const res = await fetch(\`/admin/api/links/\${currentEditCode}\`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetUrl: document.getElementById('editUrl').value })
            });
            if (res.ok) {
                closeModal();
                loadLinks();
            }
        }
        
        async function deleteLink(code) {
            if (confirm('Delete this link permanently?')) {
                const res = await fetch(\`/admin/api/links/\${code}\`, { method: 'DELETE' });
                if (res.ok) loadLinks();
            }
        }
        
        function closeModal() {
            document.getElementById('editModal').style.display = 'none';
        }
        
        async function logout() {
            await fetch('/admin/api/logout', { method: 'POST' });
            window.location.href = '/admin';
        }
        
        document.getElementById('searchInput').addEventListener('input', renderTable);
        loadLinks();
        setInterval(loadLinks, 30000);
    </script>
</body>
</html>
    `);
});

module.exports = app;
