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

module.exports = app;