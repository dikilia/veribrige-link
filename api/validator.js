// ==================== URL VALIDATOR & LINK HANDLER ====================
// Edit this file to control which URLs are allowed to be shortened
// ======================================================================

// Allowed Roblox domains (add or remove as needed)
const ALLOWED_DOMAINS = [
    'roblox.com',
    'www.roblox.com',
    'web.roblox.com',
    'api.roblox.com',
    'roblox.com.ge',
    'roblox.com.br',
    'roblox.com.tr',
    'roblox.com.mx',
    'roblox.com.au'
];

// Allowed path patterns (regular expressions)
// Add patterns for specific pages you want to allow
const ALLOWED_PATTERNS = [
    /^\/login/,              // Login page
    /^\/users\/\d+/,         // User profiles
    /^\/groups\/\d+/,        // Groups
    /^\/games\/\d+/,         // Games
    /^\/catalog/,            // Catalog items
    /^\/my\/item/,           // My items
    /^\/item/,               // Item pages
    /^\/profile/,            // Profile pages
    /^\/home/,               // Home page
    /^\/settings/,           // Settings
    /^\/account/,            // Account pages
    /^\/gifts/,              // Gift cards
    /^\/premium/,            // Premium pages
    /^\/robux/,              // Robux pages
    /^\/develop/,            // Developer pages
    /^\/create/,             // Create pages
    /^\/library/,            // Library
    /^\/trade/,              // Trading
    /^\/messages/,           // Messages
    /^\/friends/,            // Friends
    /^\/groups\/group\.aspx/, // Legacy groups
    /^\/Game\/Place\.aspx/,   // Game place
    /^\/games\/\d+\/.*/,      // Games with subpaths
    /^\/users\/\d+\/.*/       // Users with subpaths
];

// Blocked keywords (URLs containing these will be rejected)
const BLOCKED_KEYWORDS = [
    'logout',
    'signout',
    'delete',
    'remove',
    'admin',
    'moderate',
    'ban',
    'suspicious',
    'malware',
    'phishing',
    'hack',
    'exploit',
    'cheat'
];

// Custom validation function - add your own logic here
function customValidation(url, parsedUrl) {
    // Block URLs with too many redirects
    if (url.split('/').length > 15) {
        return { valid: false, message: 'URL has too many redirects' };
    }
    
    // Block URLs with special characters
    if (url.includes('<') || url.includes('>') || url.includes('"') || url.includes("'")) {
        return { valid: false, message: 'URL contains invalid characters' };
    }
    
    // Block URLs with excessive length
    if (url.length > 500) {
        return { valid: false, message: 'URL is too long (max 500 characters)' };
    }
    
    // All validations passed
    return { valid: true };
}

// Main validation function
function isValidRobloxUrl(url) {
    try {
        // Check if URL is empty
        if (!url || url.trim() === '') {
            return { valid: false, message: 'URL cannot be empty' };
        }
        
        // Add https:// if missing
        let fullUrl = url;
        if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
            fullUrl = 'https://' + fullUrl;
        }
        
        // Parse the URL
        const parsedUrl = new URL(fullUrl);
        const domain = parsedUrl.hostname;
        const path = parsedUrl.pathname;
        const fullUrlLower = fullUrl.toLowerCase();
        
        // Check for blocked keywords
        for (const keyword of BLOCKED_KEYWORDS) {
            if (fullUrlLower.includes(keyword)) {
                return { 
                    valid: false, 
                    message: `URL contains blocked keyword: "${keyword}"` 
                };
            }
        }
        
        // Check if domain is allowed
        let domainAllowed = false;
        for (const allowedDomain of ALLOWED_DOMAINS) {
            if (domain === allowedDomain || domain.endsWith('.' + allowedDomain)) {
                domainAllowed = true;
                break;
            }
        }
        
        if (!domainAllowed) {
            return { 
                valid: false, 
                message: `Domain "${domain}" is not allowed. Allowed domains: ${ALLOWED_DOMAINS.join(', ')}`,
                allowedDomains: ALLOWED_DOMAINS
            };
        }
        
        // Check if path matches any allowed pattern
        let pathAllowed = false;
        for (const pattern of ALLOWED_PATTERNS) {
            if (pattern.test(path)) {
                pathAllowed = true;
                break;
            }
        }
        
        // If no specific pattern matches, check if it's a valid Roblox page
        if (!pathAllowed) {
            // Allow root domain (just roblox.com)
            if (path === '/' || path === '') {
                pathAllowed = true;
            }
            // Allow common Roblox paths
            else if (path.startsWith('/login') || 
                     path.startsWith('/signup') ||
                     path.startsWith('/verify') ||
                     path.startsWith('/auth') ||
                     path.startsWith('/confirm') ||
                     path.startsWith('/forgot-password')) {
                pathAllowed = true;
            }
        }
        
        if (!pathAllowed) {
            return { 
                valid: false, 
                message: `Path "${path}" is not allowed. Allowed patterns include: /login, /users/123, /groups/123, /games/123`
            };
        }
        
        // Run custom validation
        const customResult = customValidation(fullUrl, parsedUrl);
        if (!customResult.valid) {
            return customResult;
        }
        
        return { valid: true, message: 'URL is valid', cleanUrl: fullUrl };
        
    } catch (error) {
        return { 
            valid: false, 
            message: `Invalid URL format: ${error.message}` 
        };
    }
}

// Function to normalize/clean URL
function normalizeUrl(url) {
    let cleanUrl = url.trim();
    
    // Add https:// if missing
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        cleanUrl = 'https://' + cleanUrl;
    }
    
    // Remove trailing slash if present
    if (cleanUrl.endsWith('/')) {
        cleanUrl = cleanUrl.slice(0, -1);
    }
    
    return cleanUrl;
}

// Function to get allowed domains list (for frontend display)
function getAllowedDomains() {
    return ALLOWED_DOMAINS;
}

// Function to get allowed patterns list (for frontend display)
function getAllowedPatterns() {
    return ALLOWED_PATTERNS.map(p => p.toString());
}

module.exports = {
    isValidRobloxUrl,
    normalizeUrl,
    getAllowedDomains,
    getAllowedPatterns,
    ALLOWED_DOMAINS,
    ALLOWED_PATTERNS
};
