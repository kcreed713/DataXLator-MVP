/* ╔════════════════════════════════════════════════════════════════════════════╗
   ✨ FILE LOG: app.js
   ──────────────────────────────────────────────────────────────────────────────
   Company: DataXLator
   Author: David Morales
   Date: 2025-11-05

   📜 CHANGE LOG
   ──────────────────────────────────────────────────────────────────────────────
   [DXL-1] (2025-11-05)
   • Added Oracle SQL → GraphQL support to Free converter.
   • Integrated backend /convert-single route.
   • Removed Pro-only converter UI and unified logic under Free tab.

   [DXL-1] (Future example)
   • Add syntax highlighting for GraphQL output in Free converter.
   ╚════════════════════════════════════════════════════════════════════════════╝ */

// --- FIREBASE IMPORTS (REQUIRED FOR AUTH & STATUS) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
// CRITICAL FIX: Added Timestamp to imports for trial logic
import { getFirestore, collection, addDoc, serverTimestamp, setLogLevel, doc, onSnapshot, setDoc, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Configuration ---
// IMPORTANT: This URL is the Render deployment.
const BULK_API_URL = 'https://dataxlator-api.onrender.com/bulk-convert';
// Story: DXL-1 — Add single-file conversion for Oracle SQL → GraphQL (Free) | David Morales | starts
const API_BASE = 'http://127.0.0.1:5000';
// Story: DXL-1 — Add single-file conversion for Oracle SQL → GraphQL (Free) | David Morales | ends


// --- TRIAL DURATION ---
const TRIAL_DURATION_DAYS = 7; 
// ------------------------------------

// --- GLOBAL FIREBASE INSTANCES & STATE ---
let db = null;
let auth = null;
let userId = null;
let isAuthReady = false;
let isPro = false; // Secure, server-managed Pro status
let trialExpiresAt = null; // To track trial expiry timestamp (in milliseconds)

// Set Firestore log level to Debug for visibility in the console
setLogLevel('debug');

/**
 * Initializes Firebase and authenticates the user anonymously for production use.
 * NOTE: User MUST replace the placeholder config with their actual production keys.
 */
async function initFirebase() {
    console.log("Initializing Firebase for Production...");

    // IMPORTANT: PRODUCTION FIREBASE CONFIG
    const firebaseConfig = {
        apiKey: "AIzaSyBdIrcFJGnsPh04bHcLJ6ef1pUDWR3ZXXw",
        authDomain: "dataxlator.firebaseapp.com",
        projectId: "dataxlator",
        storageBucket: "dataxlator.firebasestorage.app",
        messagingSenderId: "496498133573",
        appId: "1:496498133573:web:c33b441097afa8db72312c"
    };
    
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    try {
        // Sign in anonymously to get a unique user ID for secure Firestore writes
        await signInAnonymously(auth);
        console.log("Signed in anonymously.");
    } catch (error) {
        console.error("Firebase Anonymous Authentication failed:", error);
    }
    
    // Listen for auth state changes and set the user ID
    onAuthStateChanged(auth, (user) => {
        if (user) {
            userId = user.uid;
            isAuthReady = true;
            console.log(`Auth Ready. User ID: ${userId} (Source: Anonymous Auth)`);
            
            // Start the real-time Pro status listener
            setupProStatusListener();

            // Ensure the user document exists on first login
            ensureUserDocumentExists(userId);
        } else {
            userId = null;
            isAuthReady = false;
            isPro = false; // Reset Pro status if user signs out
            trialExpiresAt = null;
            updateUIForProStatus(false);
            console.log("User is signed out.");
        }
    });
}

/**
 * Ensures a placeholder document exists for the user in the production-ready path.
 * This is crucial so the backend (Webhook) knows where to write the update.
 */
async function ensureUserDocumentExists(uid) {
    if (!db || !uid) return;

    // Production Path: users/{userId}/subscriptions/dataxlator
    const statusDocRef = doc(db, `users/${uid}/subscriptions/dataxlator`);

    try {
        await setDoc(statusDocRef, { 
            isPro: false,
            createdAt: serverTimestamp(),
            lastLogin: serverTimestamp(),
        }, { merge: true });
        console.log("User document ensured at:", statusDocRef.path);
    } catch (e) {
        console.error("Failed to create user document:", e);
    }
}


// --- 1. DOM Element Selection ---
const inputData = document.getElementById('input-data');
const outputData = document.getElementById('output-data');
const executeConvertButton = document.getElementById('execute-convert');
const inputFormat = document.getElementById('input-format');
const outputFormat = document.getElementById('output-format');

// Bulk Converter Elements
const bulkFileInput = document.getElementById('bulk-file-input');
const bulkConvertButton = document.getElementById('bulk-convert-button');
const bulkMessage = document.getElementById('bulk-message');

// Email Capture Elements
const emailInput = document.getElementById('pro-email-input');
const earlyAccessButton = document.getElementById('early-access-button');
const emailCaptureForm = document.querySelector('.email-capture-form');


// --- 2. Analytics Tracking ---

/**
 * Custom function to track business objectives (monetization).
 * Sends custom events to Google Analytics 4 (GA4).
 * @param {string} eventName - The name of the event (e.g., 'CTA_Click_Upgrade_Button').
 * @param {object} eventData - Custom parameters (e.g., { type: 'monthly' }).
 */
function trackEvent(eventName, eventData = {}) {
    console.log(`[ANALYTICS] Tracking Event: ${eventName}`, eventData);
    
    // GA4 IMPLEMENTATION: Check if the gtag function exists before calling it
    if (typeof gtag === 'function') { 
        gtag('event', eventName, eventData);
    }
}

// --- 3. Pro Status Check (UPDATED) ---

/**
 * Checks if the current user has an active Pro subscription OR a non-expired trial.
 * @returns {boolean} True if the user is currently Pro or on an active trial.
 */
function isProUser() {
    // If the flag is set (permanent Pro or trial active)
    if (isPro) {
        // If there's an expiry time, check if it's in the future
        if (trialExpiresAt) {
            return Date.now() < trialExpiresAt;
        }
        // If isPro is true but trialExpiresAt is null, it's a permanent purchase, return true.
        return true;
    }
    return false;
}

/**
 * Checks if a trial is active but about to expire soon. Used for UI warnings.
 * @returns {boolean} True if trial is active and expiring within 2 days.
 */
function isTrialExpiringSoon() {
    if (trialExpiresAt && isProUser()) {
        const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
        return trialExpiresAt - Date.now() < twoDaysMs;
    }
    return false;
}

// --- Email/Trial Activation Logic (NEW/UPDATED) ---

/**
 * Activates a 7-day trial by setting the expiration timestamp in Firestore.
 * This is called when a user submits their email through the trial prompt.
 * @param {string} email - The user's email address.
 */
async function activateTrial(email) {
    if (!userId || !db) {
        showToast('Error: App not initialized. Please refresh.', 'error');
        return;
    }

    try {
        const subscriptionRef = doc(db, `users/${userId}/subscriptions/dataxlator`);
        const emailSignupRef = collection(db, 'email_signups');

        const now = Date.now();
        // Calculate expiry timestamp
        const expiresMs = now + (TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
        const expiresTimestamp = Timestamp.fromMillis(expiresMs);
        
        // 1. Set the trial status in the user's subscription document
        await setDoc(subscriptionRef, {
            isPro: true,
            updatedAt: serverTimestamp(),
            // CRITICAL: Set the expiration time in Firestore
            expiresAt: expiresTimestamp, 
            status: 'trial_active',
            trialStart: serverTimestamp(),
        }, { merge: true });

        // 2. Save the user's email for marketing/follow-up
        await addDoc(emailSignupRef, {
            email: email,
            userId: userId,
            signupDate: serverTimestamp(),
            source: 'trial_activation',
        });

        // The listener will pick up the change and update the UI immediately
        trackEvent('Trial_Activation_Success');
        
    } catch (error) {
        console.error("Error saving email or activating trial:", error);
        throw new Error("Could not activate trial. Check console for details.");
    }
}


/**
 * Handles the click event for the 'Start Trial' button and saves the email to Firestore.
 * (Original handleEarlyAccessSignup function, now adapted for trial activation)
 */
async function handleEarlyAccessSignup() {
    // We access the email input and button from the global DOM selection section (1)
    const email = emailInput ? emailInput.value.trim() : '';
    // Use the status message div in the Pro tab
    const statusMessageElement = document.getElementById('pro-status-message'); 

    if (!statusMessageElement) {
        console.error("Status message element not found.");
        return;
    }

    if (!isAuthReady) {
        statusMessageElement.textContent = "Database service not ready. Please check console.";
        statusMessageElement.style.color = '#FFC107';
        return;
    }

    if (!email || !email.includes('@')) {
        statusMessageElement.textContent = "Please enter a valid email address.";
        statusMessageElement.style.color = '#D32F2F'; // Red for error
        return;
    }

    // Disable button to prevent double submission
    if (earlyAccessButton) {
        earlyAccessButton.disabled = true;
        earlyAccessButton.textContent = 'Activating Trial...';
    }
    
    statusMessageElement.textContent = "Processing...";
    statusMessageElement.style.color = '#FFD700'; // Processing color

    try {
        // --- CRITICAL CHANGE: Activate the 7-day trial ---
        await activateTrial(email);
        
        statusMessageElement.textContent = "Success! Free 7-Day Pro Trial Activated!";
        statusMessageElement.style.color = '#4CAF50'; // Green for success
        if (emailInput) emailInput.value = ''; // Clear the input
        
        // Hide the form on success
        if (emailCaptureForm) {
            emailCaptureForm.style.display = 'none'; 
        }

    } catch (error) {
        // Error from activateTrial is caught here
        console.error("Error activating trial:", error);
        statusMessageElement.textContent = `Error: ${error.message}`;
        statusMessageElement.style.color = '#D32F2F'; // Red for error
        
        // Re-enable button on failure
        if (earlyAccessButton) {
            earlyAccessButton.disabled = false; 
            earlyAccessButton.textContent = 'Start Free Trial'; 
        }
    } finally {
        if (earlyAccessButton && statusMessageElement.style.color === '#4CAF50') {
             // Keep the button disabled and updated for a successful, one-time submission
             earlyAccessButton.textContent = 'Trial Active!';
        }
    }
}


/**
 * Updates the UI elements (like the bulk button) based on the latest Pro status.
 */
function updateBulkUI() {
    if (bulkConvertButton && bulkMessage) {
        if (isProUser()) {
            bulkConvertButton.disabled = false;
            bulkMessage.textContent = 'Pro features are unlocked. Upload your ZIP file for bulk conversion.';
            bulkMessage.style.color = '#4CAF50';
        } else {
            bulkConvertButton.disabled = false; // Soft Gate: allow click to prompt for trial
            bulkMessage.textContent = 'Bulk Conversion is a Pro Feature. Click "Bulk Convert" to start your free trial.';
            bulkMessage.style.color = '#999'; 
        }
    }
}

// --- CORE CONVERSION HELPERS (PRO FEATURES) ---

/**
 * Converts CSV text into a JSON Array of objects.
 * Assumes the first line is the header row.
 * @param {string} csvText The raw CSV string.
 * @returns {Array} An array of objects representing the data.
 */
function csvToJSON(csvText) {
    // Simple implementation: split by newline and comma. 
    // This is not robust against quoted commas or newlines, but works for clean CSV.
    const lines = csvText.trim().split('\n');
    if (lines.length <= 1) return [];

    const headerLine = lines[0];
    if (!headerLine.includes(',')) {
        return []; 
    }

    // Extract headers (first line) and sanitize them (trim, remove quotes)
    const headers = headerLine.split(',').map(h => h.trim().replace(/^['"]|['"]$/g, ''));
    const result = [];
    
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '') continue;

        const values = lines[i].split(','); 
        const obj = {};
        for (let j = 0; j < headers.length; j++) {
            const value = values[j] ? values[j].trim().replace(/^['"]|['"]$/g, '') : ''; 
            
            // Simple type coercion
            if (!isNaN(value) && value.trim() !== '') {
                obj[headers[j]] = Number(value);
            } else if (value.toLowerCase() === 'true') {
                obj[headers[j]] = true;
            } else if (value.toLowerCase() === 'false') {
                obj[headers[j]] = false;
            } else {
                obj[headers[j]] = value;
            }
        }
        result.push(obj);
    }
    return result;
}


/**
 * Converts a JSON Array of records into SQL INSERT statements.
 * @param {Array} records An array of flat JavaScript objects (records).
 * @param {string} tableName The SQL table name to use in the statement.
 * @returns {string} The concatenated SQL INSERT statements.
 */
function jsonToSQL(records, tableName = 'dataxlator_records') {
    // Ensure we have an array of objects to work with
    if (!Array.isArray(records) || records.length === 0) {
        return `/* No valid records found for SQL conversion. */`;
    }

    // Use the keys of the first record as column names
    const firstRecord = records[0];
    const columns = Object.keys(firstRecord);

    // Helper to safely format value for SQL
    const formatValue = (value) => {
        if (value === null || value === undefined) {
            return 'NULL';
        }
        
        // Handle complex objects and arrays by serializing to JSON string
        if (typeof value === 'object') {
            const jsonString = JSON.stringify(value);
            // Escape single quotes within the JSON string and wrap the whole thing in SQL quotes
            return `'${jsonString.replace(/'/g, "''")}'`;
        }
        
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        // Handle simple strings: escape single quotes and wrap in SQL quotes
        return `'${String(value).replace(/'/g, "''")}'`;
    };

    // Prepare column list (e.g., `col1`, `col2`)
    const columnList = columns.map(col => `\`${col}\``).join(', ');
    let sqlStatements = [`-- Generated SQL INSERT statements for table: ${tableName}\n`];

    // Generate an INSERT statement for each record
    records.forEach(record => {
        const values = columns.map(col => formatValue(record[col]));
        sqlStatements.push(
            `INSERT INTO \`${tableName}\` (${columnList}) VALUES (${values.join(', ')});`
        );
    });

    return sqlStatements.join('\n');
}

// --- 4. Core Conversion Logic (Free Tier) ---

/**
 * Helper function to safely parse a string and determine if it is valid JSON.
 * @param {string} str The input string.
 * @returns {object|null} The parsed object if valid JSON, otherwise null.
 */
function tryParseJSON(str) {
    if (typeof str !== 'string' || str.trim().length === 0) {
        return null;
    }
    try {
        return JSON.parse(str);
    } catch (e) {
        return null;
    }
}

/**
 * Executes the data conversion based on the selected formats.
 * This is triggered on input change, format change, or button click.
 */
function translateData() {
    outputData.value = ''; // Clear output initially
    inputData.classList.remove('error'); // Clear input error state
    outputData.classList.remove('error'); 

    const inputText = inputData.value.trim();
    let inputFormatValue = inputFormat.value; 
    const outputFormatValue = outputFormat.value;

    // DX-1: Oracle SQL → GraphQL (Free Tab calls backend) | David Morales | starts
    if (inputFormatValue === 'oracle-sql' && outputFormatValue === 'graphql') {

    // basic empty-input guard (keeps your existing behavior)
    if (!inputText) return;

    // show a quick "working..." message
    outputData.value = '⏳ Converting Oracle SQL to GraphQL...';

    fetch(`${API_BASE}/convert_pro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        input_format: 'oracle-sql',
        output_format: 'graphql',
        content: inputText
        })
    })
        .then(async (res) => {
        if (!res.ok) {
            // bubble up any server JSON error payloads
            const maybeJson = await res.text();
            try {
            const j = JSON.parse(maybeJson);
            throw new Error(j.error || maybeJson);
            } catch {
            throw new Error(maybeJson || `HTTP ${res.status}`);
            }
        }
        return res.json();
        })
        .then((data) => {
        // expect { output: "<graphql schema or op>" }
        outputData.value = data.output || '';
        })
        .catch((err) => {
        outputData.value = `❌ ${err.message || 'Conversion failed.'}`;
        inputData.classList.add('error');
        console.error('[DX-123] OracleSQL→GraphQL error:', err);
        });

    return; // IMPORTANT: skip the JSON/YAML client-side logic below
    }
    // DX-1: Oracle SQL → GraphQL (Free Tab calls backend) | David Morales | ends
    
    // 1. Check for empty input
    if (inputText.length === 0) {
        return; // Do nothing if input is empty
    }
    
    // 2. Prevent conversion to the same format (UX Improvement)
    if (inputFormatValue === outputFormatValue) {
        outputData.value = '❌ Input and Output formats are the same. Please select different formats.';
        inputData.classList.add('error');
        return;
    }

    // 3. Pro Feature Monetization Check (CSV/SQL)
    if ((inputFormatValue === 'csv' || outputFormatValue === 'sql') ||
        (inputFormatValue === 'sql' && outputFormatValue === 'graphql')
    && !isProUser()) {
        outputData.value = '🛑 PRO FEATURE REQUIRED 🛑\n\nThis conversion requires DataXLator Pro. Please check the "Pro Features" tab to start your 7-day free trial.';
        inputData.classList.add('error');
        trackEvent('PRO_Conversion_Attempt', { conversion: `${inputFormatValue}-to-${outputFormatValue}` });
        if (typeof openTab === 'function') openTab('pro');
        return; // BLOCK UNLESS PRO
    }
        
    let parsedObject = null;

    // --- CORE LOGIC (PARSING/INPUT STAGE) ---
    
    if (inputFormatValue === 'csv') {
        // PRO: Convert CSV to a standard JavaScript Array of Objects
        try {
            parsedObject = csvToJSON(inputText);
        } catch (e) {
            outputData.value = `❌ CSV Parsing Error: ${e.message}`;
            inputData.classList.add('error');
            return;
        }
    } else {
        if (inputFormatValue === 'yaml') {
            // User explicitly chose YAML. Try to parse as YAML.
            try {
                // jsyaml.load is expected to be available
                parsedObject = jsyaml.load(inputText);
                
                // Check for primitive types (like simple string from CSV)
                if (typeof parsedObject !== 'object' || parsedObject === null) {
                    if (!Array.isArray(parsedObject) || parsedObject.length !== 0) {
                        throw new Error("Input could not be parsed as a structured YAML object or array.");
                    }
                }
                
            } catch (e) {
                outputData.value = `❌ YAML Parsing Error: ${e.message}`;
                inputData.classList.add('error');
                trackEvent('Conversion_Error', { conversion: 'yaml-parse', error: e.message });
                return;
            }
        
        } else {
            // If user chose 'json' or 'select', attempt JSON parsing first for robustness
            const jsonCandidate = tryParseJSON(inputText);

            if (jsonCandidate !== null) {
                // If it's valid JSON, we MUST treat the input as JSON.
                inputFormatValue = 'json';
                parsedObject = jsonCandidate;
            } 
        }
    }
    
    // 4. Handle Parsing Failure 
    if (parsedObject === null || (Array.isArray(parsedObject) && parsedObject.length === 0)) {
        outputData.value = `❌ Could not parse input as ${inputFormatValue.toUpperCase()}. Please check your syntax/structure.`;
        inputData.classList.add('error');
        trackEvent('Conversion_Parse_Failure', { format: inputFormatValue });
        return;
    }

    // --- CONVERSION & OUTPUT STAGE (STEP 4) ---

    let outputText = '';
    let conversionPath = `${inputFormatValue}-to-${outputFormatValue}`;
    
    try {
        if (outputFormatValue === 'sql') {
            // PRO: Convert parsed object (expected to be an Array of Objects from CSV/JSON) to SQL.
            // If the input was JSON but not an array, wrap it to handle single-record JSON.
            const records = Array.isArray(parsedObject) ? parsedObject : [parsedObject];
            outputText = jsonToSQL(records);

        } else if (outputFormatValue === 'yaml') {
            // Convert JS object to YAML string
            outputText = jsyaml.dump(parsedObject);

        } else if (outputFormatValue === 'json') {
            // Convert JS object back to JSON string (formatted with 2-space indentation)
            outputText = JSON.stringify(parsedObject, null, 2); 
        } 
        
        outputData.value = outputText;
        trackEvent('Conversion_Success', { path: conversionPath });


    } catch (e) {
        // Handle conversion errors 
        outputData.value = `Error during final conversion to ${outputFormatValue.toUpperCase()}.\n\nDetails: ${e.message}`;
        outputData.classList.add('error');
    }
}


// --- 5. Bulk Conversion Logic (Pro Tier) (UPDATED SOFT GATE) ---

/**
 * Handles the upload of a ZIP file for bulk conversion via the backend API.
 */
async function handleBulkConversion() {
    // --- Soft Trial Gate Check ---
    if (!isProUser()) {
        bulkMessage.textContent = '🔒 Start your 7-day free trial to unlock bulk conversion!';
        bulkMessage.style.color = '#FFC107'; 
        if (typeof openTab === 'function') openTab('pro');
        return; 
    }
    
    bulkMessage.textContent = ''; 
    const files = bulkFileInput.files;
    
    if (files.length === 0) {
        bulkMessage.textContent = 'Please select a ZIP file to upload.';
        return;
    }
    
    if (files.length > 1) {
        bulkMessage.textContent = 'Only one ZIP file can be uploaded at a time.';
        return;
    }

    const zipFile = files[0];
    const formData = new FormData();
    formData.append('zip_file', zipFile);
    
    trackEvent('PRO_Bulk_Conversion_Attempt', { conversion: 'BULK_API_CALL' });

    bulkConvertButton.disabled = true;
    bulkMessage.textContent = 'Processing files... please wait (up to 30 seconds for large files).';
    bulkMessage.style.color = '#FFD700'; // Yellow/Processing color
    
    // 1. Check if the user ID is available
    if (!userId) {
        bulkMessage.textContent = '❌ Authentication Error: User ID is missing.';
        bulkMessage.style.color = '#D32F2F';
        bulkConvertButton.disabled = false;
        return;
    }

    // 2. Construct the dynamic API URL with the userId query parameter
    const dynamicApiUrl = `${BULK_API_URL}?user_id=${userId}`; 

    try {
        // Use the new dynamic URL in the fetch request
        const response = await fetch(dynamicApiUrl, {
            method: 'POST',
            body: formData,
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'dataxlator_converted_files.zip'; 
            
            document.body.appendChild(a);
            a.click();
            
            window.URL.revokeObjectURL(url); 
            document.body.removeChild(a); 
            bulkMessage.textContent = 'Download started successfully!';
            bulkMessage.style.color = '#4CAF50'; // Green/Success color
            bulkFileInput.value = null; // Clear file input

        } else {
            const errorText = await response.text();
            let errorMessage = `API Error (${response.status}): ${errorText}`;
            
            try {
                const errorJson = JSON.parse(errorText);
                // The server sends back {"error": "Access Denied..."}
                errorMessage = `API Error: ${errorJson.error || 'Unknown Server Error'}`;
            } catch (e) {
                // keep raw text if not JSON
            }

            bulkMessage.textContent = `❌ ${errorMessage}`;
            bulkMessage.style.color = '#D32F2F'; // Red/Error color
        }

    } catch (error) {
        console.error('Network or Fetch Error:', error);
        bulkMessage.textContent = `❌ Connection Error. Is the backend server running at ${BULK_API_URL}?`;
        bulkMessage.style.color = '#D32F2F';
    } finally {
        bulkConvertButton.disabled = false;
    } 
}

// ----------------------------------------------------------------------
// --- NEW PRO STATUS UI LOGIC (FIREBASE INTEGRATED) ---
// ----------------------------------------------------------------------

/**
 * Shows a temporary, one-time notification for a newly authenticated Pro user.
 */
function showProWelcomeNotification() {
    // IMPORTANT: Changed storage mechanism to be less permanent, but still session-based for UX
    const hasSeenWelcome = sessionStorage.getItem('dataxlator_pro_welcome_seen');

    if (!hasSeenWelcome) {
        const toast = document.createElement('div');
        toast.id = 'pro-welcome-toast';
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background-color: #FFD700; /* Gold */
            color: #000;
            padding: 15px 25px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            font-weight: bold;
            font-family: 'Inter', sans-serif;
            z-index: 9999;
            opacity: 0;
            transform: translateY(-50px);
            transition: opacity 0.5s ease-out, transform 0.5s ease-out;
        `;
        toast.textContent = '🎉 Congratulations! Pro Status Unlocked.';
        document.body.appendChild(toast);

        // Animate the toast in
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        }, 10);

        // Animate the toast out and remove it after 5 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-50px)';
        }, 5000);

        setTimeout(() => {
            toast.remove();
        }, 5500);

        // Set flag so it only shows once per session to avoid annoying users
        sessionStorage.setItem('dataxlator_pro_welcome_seen', 'true');
    }
}

/**
 * Updates the UI state based on the user's Pro status from Firestore.
 * @param {boolean} newIsPro - True if the user has Pro access.
 */
function updateUIForProStatus(newIsPro) {
    // 1. Update the global state
    isPro = newIsPro;

    const bulkConvertButton = document.getElementById('bulk-convert-button');
    const inputFormatSelect = document.getElementById('input-format');
    const outputFormatSelect = document.getElementById('output-format');

    // 2. Locate and enable/disable Pro-only options (CSV Input, SQL Output)
    const csvProOption = inputFormatSelect ? inputFormatSelect.querySelector('option[value="csv"]') : null;
    const sqlProOption = outputFormatSelect ? outputFormatSelect.querySelector('option[value="sql"]') : null;

    if (csvProOption) {
        // Hard-gate disabled. We rely on the check inside translateData to gate.
        csvProOption.disabled = false; 
        csvProOption.textContent = isPro ? 'CSV' : 'CSV (PRO)';
    }

    if (sqlProOption) {
         // Hard-gate disabled. We rely on the check inside translateData to gate.
        sqlProOption.disabled = false;
        sqlProOption.textContent = isPro ? 'SQL INSERT' : 'SQL INSERT (PRO)';
    }

    // Safety: If a disabled option is currently selected, reset to JSON and re-run translate
    if (!isPro && outputFormatSelect && outputFormatSelect.value === 'sql') {
        // Don't auto-reset selection, allow them to choose it, but the conversion will be blocked.
        // outputFormatSelect.value = 'json';
        translateData();
    }
    if (!isPro && inputFormatSelect && inputFormatSelect.value === 'csv') {
        // Don't auto-reset selection, allow them to choose it, but the conversion will be blocked.
        // inputFormatSelect.value = 'json';
        translateData();
    }

    // 3. Enable/Disable the Bulk Conversion Button and update its message
    updateBulkUI();

    // 4. Handle successful Pro Upgrade (instant feedback)
    if (isPro) {
        // A. Automatically switch to the "Pro Features" tab.
        const currentTab = document.querySelector('.tab-button.active')?.dataset.tab;
        if (typeof openTab === 'function' && currentTab !== 'pro') {
            openTab('pro');
        }

        // B. Show the one-time welcome notification.
        showProWelcomeNotification();
        
        // C. If the form is visible (i.e., they just activated a trial), hide it
        if (emailCaptureForm) {
            emailCaptureForm.style.display = 'none'; 
            const statusMessageElement = document.getElementById('pro-status-message');
            if(statusMessageElement) {
                statusMessageElement.textContent = "Your 7-day free trial is active!";
                statusMessageElement.style.color = '#4CAF50';
            }
        }
    } else {
        // If status reverts to false (e.g., trial expired)
         if (emailCaptureForm) {
            emailCaptureForm.style.display = 'block'; 
        }
    }
}

/**
 * Sets up a real-time Firestore listener to monitor the user's Pro status.
 * (UPDATED to include trial expiration logic)
 */
function setupProStatusListener() {
    if (!db || !userId) {
        console.error("Cannot set up Pro listener: DB or User ID is missing.");
        return;
    }
    
    // Production Path: users/{userId}/subscriptions/dataxlator
    const statusDocRef = doc(db, `users/${userId}/subscriptions/dataxlator`);

    // onSnapshot provides real-time updates for Pro status
    onSnapshot(statusDocRef, (docSnap) => {
        let newIsPro = false;
        let prevIsPro = isPro; // Capture previous state

        if (docSnap.exists()) {
            const userData = docSnap.data();
            newIsPro = userData.isPro === true;
            
            // CRITICAL: Check and set the trial expiration time
            if (userData.expiresAt && userData.expiresAt.toMillis) {
                trialExpiresAt = userData.expiresAt.toMillis();
            } else {
                trialExpiresAt = null; // Permanent Pro user (or no trial)
            }
            
            // If the Pro flag is set (newIsPro is true) but the trial time is in the past, reset newIsPro.
            // This is the core trial expiry check.
            if (newIsPro && trialExpiresAt && Date.now() > trialExpiresAt) {
                 console.log("Trial expired, reverting status.");
                 newIsPro = false;
            }
        }

        // Only run the heavy UI update if the final status actually changed
        if (newIsPro !== prevIsPro) {
            console.log(`Real-time Pro Status Change Detected: ${newIsPro ? 'UPGRADED' : 'EXPIRED'}`);
            updateUIForProStatus(newIsPro);
        }

    }, (error) => {
        console.error("Error listening to Pro status:", error);
        // Default to non-pro status on listener error
        updateUIForProStatus(false);
    });
}

// --- 6. Event Listeners ---

function initDOMAndListeners() {
    // 1. Initialize Firebase and Authentication
    initFirebase();
    
    // 2. Set up event listeners for the Free Converter
    if (executeConvertButton) {
        executeConvertButton.addEventListener('click', translateData);
    }
    if (inputData) {
        inputData.addEventListener('input', translateData); 
    }
    if (inputFormat) {
        inputFormat.addEventListener('change', translateData);
    }
    if (outputFormat) {
        outputFormat.addEventListener('change', translateData);
    }
    
    // 3. Set up event listener for the PRO Early Access signup (Now Trial Activation)
    if (earlyAccessButton) {
        earlyAccessButton.addEventListener('click', handleEarlyAccessSignup);
        // Update button text to reflect the new trial gate goal
        earlyAccessButton.textContent = 'Start 7-Day Free Trial'; 
    }

    // 4. Set up event listener for Bulk Conversion (Pro Feature Soft Gate)
    if (bulkConvertButton) {
        bulkConvertButton.addEventListener('click', handleBulkConversion);
    }

    // 5. Dynamically insert a status message container near the form for user feedback
    if (emailCaptureForm) {
        const statusDiv = document.createElement('div');
        statusDiv.id = 'pro-status-message';
        statusDiv.style.marginTop = '10px';
        statusDiv.style.minHeight = '20px'; // Reserve space
        // Set initial prompt text
        statusDiv.textContent = 'Enter your email to activate a 7-day free trial and unlock all Pro features.';
        statusDiv.style.color = '#5a67d8'; // Blue color for a call to action
        emailCaptureForm.parentNode.insertBefore(statusDiv, emailCaptureForm);
    }
    
    // Initial UI update based on the default false 'isPro' status
    updateUIForProStatus(false);
}

// Story: DXL-1 — Add single-file conversion for Oracle SQL → GraphQL (Free) | David Morales | starts
// IDs used in your Free UI (adjust if yours differ)
const inputSel   = document.getElementById('input-format');
const outputSel  = document.getElementById('output-format');
const inputBox   = document.getElementById('input-text')   || document.getElementById('input-data');
const outputBox  = document.getElementById('output-text')  || document.getElementById('output-data');
const convertBtn = document.getElementById('convert-btn')  || document.getElementById('execute-convert');

function norm(v) {
  // normalize labels/values like "Oracle SQL", "oracle-sql", "SQL"
  return (v || '').toString().trim().toLowerCase().replace(/\s+/g, '-');
}

async function handleFreeConvert() {
  const inFmt  = norm(inputSel.value);
  const outFmt = norm(outputSel.value);
  const content = inputBox.value || '';

  // ---- Oracle SQL → GraphQL goes to backend ----
  if (['sql','oracle-sql','oracle'].includes(inFmt) && ['graphql','graph-ql'].includes(outFmt)) {
    if (!content.trim()) {
      outputBox.value = 'Please paste your Oracle SQL first.';
      return;
    }

    outputBox.value = '⏳ Converting…';
    try {
      const res = await fetch(`${API_BASE}/convert-single`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputFormat: 'sql',        // what your Flask route expects
          outputFormat: 'graphql',   // what your Flask route expects
          content
        })
      });

      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = { error: text }; }

      if (!res.ok || data.error) {
        outputBox.value = `✗ ${data.error || 'Conversion failed.'}`;
        return;
      }
      outputBox.value = data.converted || '';
    } catch (e) {
      outputBox.value = `✗ Network error: ${e}`;
    }
    return; // don't fall through to JSON/YAML code
  }

}

if (convertBtn) {
  convertBtn.addEventListener('click', handleFreeConvert);
}
// Story: DXL-1 — Add single-file conversion for Oracle SQL → GraphQL (Free) | David Morales | ends

document.addEventListener('DOMContentLoaded', initDOMAndListeners);