// --- Configuration ---
// IMPORTANT: This URL has been updated to your Render deployment.
const BULK_API_URL = 'https://dataxlator-api.onrender.com/bulk-convert'; 

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
    // Check if the 'dataxlator_pro_status' flag is set to 'active'
    return localStorage.getItem('dataxlator_pro_status') === 'active';
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
        // NOTE: JSON.parse can return primitives. We return the result to ensure
        // the object is passed, even if it's a primitive, for conversion purposes.
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
    
    // 2. NEW: Prevent conversion to the same format (UX Improvement)
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
    
    // Attempt 1: Auto-detect JSON first (Your robust logic)
    const jsonCandidate = tryParseJSON(inputText);

    if (jsonCandidate !== null) {
        // If it's valid JSON, we MUST treat the input as JSON.
        inputFormatValue = 'json';
        parsedObject = jsonCandidate;
    } else if (inputFormatValue === 'yaml') {
        // If it wasn't JSON, and the user selected YAML, try parsing it as YAML.
        try {
            parsedObject = jsyaml.load(inputText);
        } catch (e) {
            outputData.value = `❌ YAML Parsing Error: ${e.message}`;
            inputData.classList.add('error');
            trackEvent('Conversion_Error', { conversion: 'yaml-parse', error: e.message });
            return;
        }
    } 
    
    // 4. Handle Parsing Failure 
    if (parsedObject === null) {
        outputData.value = `❌ Could not parse input as ${inputFormatValue.toUpperCase()}. Please check your syntax.`;
        inputData.classList.add('error');
        trackEvent('Conversion_Parse_Failure', { format: inputFormatValue });
        return;
    }

    // --- CONVERSION & OUTPUT STAGE (STEP 4) ---

    let outputText = '';
    let conversionPath = `${inputFormatValue}-to-${outputFormatValue}`;
    
    try {
        if (outputFormatValue === 'yaml') {
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

// --- 4. Bulk Conversion Logic (Pro Tier) ---

/**
 * Handles the upload of a ZIP file for bulk conversion via the backend API.
 */
async function handleBulkConversion() {
    if (!isProUser()) {
        // 1. Disable the button
        bulkConvertButton.disabled = true;
        
        // 2. Set a clear message
        bulkMessage.textContent = 'Bulk Conversion is a Pro Feature. Upgrade to unlock.';
        bulkMessage.style.color = '#999'; 
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
    
    try {
        const response = await fetch(BULK_API_URL, {
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
                errorMessage = `API Error: ${errorJson.error || 'Unknown Server Error'}`;
            } catch (e) {
                // keep raw text
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

// --- 5. Event Listeners ---

// Single-File Feature Listeners
executeConvertButton.addEventListener('click', translateData);
// Using 'input' event for real-time conversion
inputData.addEventListener('input', translateData); 
inputFormat.addEventListener('change', translateData);
outputFormat.addEventListener('change', translateData);

// Pro Feature Listener (inside the "Pro Features" tab)
bulkConvertButton.addEventListener('click', handleBulkConversion);

// Run the Pro User check when the entire page is loaded
document.addEventListener('DOMContentLoaded', handleBulkConversion);
// You should also call this function after a successful payment