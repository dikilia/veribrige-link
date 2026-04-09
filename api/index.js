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
    
    // Validate URL
    const validation = validator.isValidRobloxUrl(url);
    
    if (!validation.valid) {
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
    res.sendFile('/public/admin/dashboard.html', { root: '.' });
});

// ==================== ADMIN LOGIN PAGE ====================
app.get('/admin', (req, res) => {
    res.sendFile('/public/admin/index.html', { root: '.' });
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
