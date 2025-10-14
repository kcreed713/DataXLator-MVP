// --- FIREBASE IMPORTS (REQUIRED FOR AUTH & STATUS) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, serverTimestamp, setLogLevel, doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Configuration ---
// IMPORTANT: This URL is the Render deployment.
const BULK_API_URL = 'https://dataxlator-api.onrender.com/bulk-convert';

// --- GLOBAL FIREBASE INSTANCES & STATE ---
let db = null;
let auth = null;
let userId = null;
let isAuthReady = false;
let isPro = false; // Secure, server-managed Pro status

// Set Firestore log level to Debug for visibility in the console
setLogLevel('debug');

/**
 * Initializes Firebase and authenticates the user anonymously for production use.
 * NOTE: User MUST replace the placeholder config with their actual production keys.
 */
async function initFirebase() {
    console.log("Initializing Firebase for Production...");

    // IMPORTANT: REPLACE THESE PLACEHOLDERS WITH YOUR PRODUCTION FIREBASE CONFIG
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

// --- 3. Pro Status Check ---
function isProUser() {
    // Returns the global, secure, server-managed state
    return isPro; 
}

/**
 * Updates the UI elements (like the bulk button) based on the latest Pro status.
 */
function updateBulkUI() {
    if (bulkConvertButton && bulkMessage) {
        if (isPro) {
            bulkConvertButton.disabled = false;
            bulkMessage.textContent = 'Pro features are unlocked. Upload your ZIP file for bulk conversion.';
            bulkMessage.style.color = '#4CAF50';
        } else {
            bulkConvertButton.disabled = true;
            bulkMessage.textContent = 'Bulk Conversion is a Pro Feature. Upgrade to unlock.';
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
    if ((inputFormatValue === 'csv' || outputFormatValue === 'sql') && !isProUser()) {
        outputData.value = '🛑 PRO FEATURE REQUIRED 🛑\n\nThis conversion requires DataXLator Pro. Please check the "Pro Features" tab.';
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


/**
 * Handles the click event for the 'Get Early Access' button and saves the email to Firestore.
 */
async function handleEarlyAccessSignup() {
    // We access the email input and button from the global DOM selection section (1)
    const email = emailInput ? emailInput.value.trim() : '';
    let statusMessageElement = document.getElementById('pro-status-message'); // Dynamic element lookup

    if (!statusMessageElement) {
        console.error("Status message element not found.");
        return;
    }

    if (!isAuthReady) {
        statusMessageElement.textContent = "Database service not ready. Please check console.";
        statusMessageElement.style.color = '#FFC107';
        console.warn("Attempted signup before auth was ready.");
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
        earlyAccessButton.textContent = 'Subscribing...';
    }
    
    statusMessageElement.textContent = "Processing...";
    statusMessageElement.style.color = '#999';

    try {
        // Production collection path: 'email_signups'
        const emailCollectionRef = collection(db, 'email_signups');

        await addDoc(emailCollectionRef, {
            email: email,
            timestamp: serverTimestamp(),
            userId: userId, // The Authenticated UID
            signup_source: 'early_access_pro_tab'
        });

        statusMessageElement.textContent = "Success! You are on the Early Access list!";
        statusMessageElement.style.color = '#4CAF50'; // Green for success
        if (emailInput) emailInput.value = ''; // Clear the input
        console.log(`Email successfully captured for user ${userId}.`);

    } catch (error) {
        console.error("Error saving email to Firestore:", error);
        statusMessageElement.textContent = "Error: Could not save your email. Check console for details.";
        statusMessageElement.style.color = '#D32F2F'; // Red for error
        if (earlyAccessButton) {
            earlyAccessButton.disabled = false; // Re-enable on failure
        }
    } finally {
        if (earlyAccessButton) {
            // Only re-enable the button if signup was unsuccessful
            if (statusMessageElement.style.color === '#D32F2F') {
                earlyAccessButton.textContent = 'Get Early Access';
            } else {
                // Keep the button disabled and updated for a successful, one-time submission
                earlyAccessButton.textContent = 'Subscribed!';
            }
        }
    }
}


// --- 5. Bulk Conversion Logic (Pro Tier) ---

/**
 * Handles the upload of a ZIP file for bulk conversion via the backend API.
 */
async function handleBulkConversion() {
    // Check global status (updated in real-time by setupProStatusListener)
    if (!isProUser()) {
        updateBulkUI(); // Ensures message is correct
        return; // Exit early if not Pro
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
    
    // --- CRITICAL FIX START ---
    // 1. Check if the user ID is available
    if (!userId) {
        bulkMessage.textContent = '❌ Authentication Error: User ID is missing.';
        bulkMessage.style.color = '#D32F2F';
        bulkConvertButton.disabled = false;
        return;
    }

    // 2. Construct the dynamic API URL with the userId query parameter
    const dynamicApiUrl = `${BULK_API_URL}?user_id=${userId}`; 
    // --- CRITICAL FIX END ---

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
    const hasSeenWelcome = localStorage.getItem('dataxlator_pro_welcome_seen');

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
        localStorage.setItem('dataxlator_pro_welcome_seen', 'true');
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
        csvProOption.disabled = !isPro;
        csvProOption.textContent = isPro ? 'CSV' : 'CSV (PRO)';
    }

    if (sqlProOption) {
        sqlProOption.disabled = !isPro;
        sqlProOption.textContent = isPro ? 'SQL INSERT' : 'SQL INSERT (PRO)';
    }

    // Safety: If a disabled option is currently selected, reset to JSON and re-run translate
    if (!isPro && outputFormatSelect && outputFormatSelect.value === 'sql') {
        outputFormatSelect.value = 'json';
        translateData();
    }
    if (!isPro && inputFormatSelect && inputFormatSelect.value === 'csv') {
        inputFormatSelect.value = 'json';
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
    }
}

/**
 * Sets up a real-time Firestore listener to monitor the user's Pro status.
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
        if (docSnap.exists()) {
            const userData = docSnap.data();
            newIsPro = userData.isPro === true;
        }

        // Only run the heavy UI update if the status actually changed
        if (newIsPro !== isPro) {
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
    
    // 3. Set up event listener for the PRO Early Access signup
    if (earlyAccessButton) {
        earlyAccessButton.addEventListener('click', handleEarlyAccessSignup);
    }

    // 4. Set up event listener for Bulk Conversion (Pro Feature)
    if (bulkConvertButton) {
        bulkConvertButton.addEventListener('click', handleBulkConversion);
    }

    // 5. Dynamically insert a status message container near the form for user feedback
    if (emailCaptureForm) {
        const statusDiv = document.createElement('div');
        statusDiv.id = 'pro-status-message';
        statusDiv.style.marginTop = '10px';
        statusDiv.style.minHeight = '20px'; // Reserve space
        emailCaptureForm.parentNode.insertBefore(statusDiv, emailCaptureForm.nextSibling);
    }
    
    // Initial UI update based on the default false 'isPro' status
    updateUIForProStatus(false);
}

document.addEventListener('DOMContentLoaded', initDOMAndListeners);