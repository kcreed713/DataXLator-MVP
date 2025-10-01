// --- Configuration ---
// IMPORTANT: This URL has been updated to your Render deployment.
const BULK_API_URL = 'https://dataxlator-api.onrender.com/bulk-convert'; 

// --- 1. DOM Element Selection ---
const inputData = document.getElementById('input-data');
const outputData = document.getElementById('output-data');
const executeConvertButton = document.getElementById('execute-convert');
const swapButton = document.getElementById('swap-button');
const directionDisplay = document.getElementById('direction-display');
const inputFormat = document.getElementById('input-format');
const outputFormat = document.getElementById('output-format');

// Bulk Converter Elements
const bulkFileInput = document.getElementById('bulk-file-input');
const bulkConvertButton = document.getElementById('bulk-convert-button');
const bulkMessage = document.getElementById('bulk-message');

// Internal state to track the conversion direction
let conversionDirection = 'json-to-yaml'; 

// --- 2. State Management (Toggle Direction) ---

/**
 * Toggles the conversion direction state and updates the UI display.
 */
function toggleDirection() {
    if (conversionDirection === 'json-to-yaml') {
        conversionDirection = 'yaml-to-json';
        directionDisplay.textContent = 'YAML ➡️ JSON';
        inputData.placeholder = 'Paste YAML data here...';
    } else {
        conversionDirection = 'json-to-yaml';
        directionDisplay.textContent = 'JSON ➡️ YAML';
        inputData.placeholder = 'Paste JSON data here...';
    }
    outputData.value = '';
    outputData.classList.remove('error');
    bulkMessage.textContent = ''; // Clear bulk message on direction change
}


// --- 3. Analytics Tracking (Placeholder) ---

function trackEvent(eventName, eventProperties = {}) {
    // Simple console log for MVP launch. Replace with GA/PostHog SDK later.
    console.log(`[ANALYTICS] Event: ${eventName}`, eventProperties);
}

// --- 4. Conversion Logic (Free Tier) ---

/**
 * Executes the data conversion based on the selected formats.
 * This is triggered on input change, format change, or button click.
 */
function translateData() {
    outputData.value = ''; // Clear output initially
    outputData.classList.remove('error'); // Clear error state

    const input = inputData.value.trim();
    const inputFormatValue = inputFormat.value;
    const outputFormatValue = outputFormat.value;
    
    // 1. Check for empty input
    if (input.length === 0) {
        return; // Do nothing if input is empty
    }

    // 2. Pro Feature Monetization Check (CSV, SQL)
    if (inputFormatValue === 'csv' || outputFormatValue === 'sql') {
        outputData.value = '🛑 PRO FEATURE REQUIRED 🛑\n\nConversion between CSV, SQL, or other advanced formats requires a Pro subscription.\n\nPlease switch to the "Pro Features" tab to unlock advanced conversions.';
        outputData.classList.add('error');
        // Log the monetization attempt
        trackEvent('PRO_Conversion_Attempt', { input: inputFormatValue, output: outputFormatValue });
        return;
    }

    // 3. Determine the conversion path
    let output = '';
    let conversionPath = `${inputFormatValue}-to-${outputFormatValue}`;
    
    try {
        if (conversionPath === 'json-to-yaml') {
            // Note: The js-yaml library is used for both conversion functions.
            const data = JSON.parse(input);
            output = jsyaml.dump(data);

        } else if (conversionPath === 'yaml-to-json') {
            const data = jsyaml.load(input); // Use js-yaml's load for YAML input
            output = JSON.stringify(data, null, 2); // Use JSON.stringify for JSON output

        } else {
            // Should not happen with current options, but good for safety
            output = `Error: Unsupported conversion path (${conversionPath}).`;
        }

        outputData.value = output;

    } catch (e) {
        // 4. Handle conversion errors (e.g., invalid JSON/YAML syntax)
        outputData.value = `Error: Invalid ${inputFormatValue.toUpperCase()} format.\n\nDetails: ${e.message}`;
        outputData.classList.add('error');
    }
}

// --- 5. Bulk Conversion Logic (Pro Tier) ---

/**
 * Handles the upload of a ZIP file for bulk conversion via the backend API.
 */
async function handleBulkConversion() {
    bulkMessage.textContent = ''; // Clear previous messages
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
    
    // Add tracking for the conversion attempt
    trackEvent('PRO_Bulk_Conversion_Attempt', { conversion: conversionDirection });

    // Set UI state for loading
    bulkConvertButton.disabled = true;
    bulkMessage.textContent = 'Processing files... please wait (up to 30 seconds for large files).';
    
    try {
        const response = await fetch(BULK_API_URL, {
            method: 'POST',
            body: formData,
        });

        if (response.ok) {
            // 1. Get the converted file as a Blob
            const blob = await response.blob();

            // 2. Create a temporary URL for the Blob
            const url = window.URL.createObjectURL(blob);
            
            // 3. Create a temporary link element
            const a = document.createElement('a');
            a.href = url;
            a.download = 'dataxlator_converted_files.zip'; // Set the download filename
            
            // 4. Programmatically click the link to start the download
            document.body.appendChild(a);
            a.click();
            
            // 5. Cleanup
            window.URL.revokeObjectURL(url); // Clean up the temporary URL
            document.body.removeChild(a); // Remove the temporary link
            bulkMessage.textContent = 'Download started successfully!';
            bulkFileInput.value = null; // Clear file input

        } else {
            // 6. Handle API Errors (e.g., file too large, zero valid files)
            const errorText = await response.text();
            let errorMessage = `API Error (${response.status}): ${errorText}`;
            
            try {
                // Try to parse JSON error from Python server
                const errorJson = JSON.parse(errorText);
                errorMessage = `API Error: ${errorJson.error || 'Unknown Server Error'}`;
            } catch (e) {
                // Keep the raw text if parsing fails
            }

            bulkMessage.textContent = `❌ ${errorMessage}`;
        }

    } catch (error) {
        // 7. Handle Network or CORS Errors
        console.error('Network or Fetch Error:', error);
        bulkMessage.textContent = `❌ Connection Error. Is the backend server running at ${BULK_API_URL}?`;
    } finally {
        bulkConvertButton.disabled = false;
    }
}

// --- 5. Event Listeners ---

// Single-File Feature Listeners
// These are attached to the core elements in the "Free Converter" tab
executeConvertButton.addEventListener('click', translateData);
inputData.addEventListener('input', translateData);

// CRITICAL FIX: Conversion should run whenever a format is selected.
// NOTE: These variables must be defined in the app.js file (inputFormat, outputFormat)
//const inputFormat = document.getElementById('input-format');
//const outputFormat = document.getElementById('output-format');
inputFormat.addEventListener('change', translateData);
outputFormat.addEventListener('change', translateData);

// Pro Feature Listener (inside the "Pro Features" tab)
bulkConvertButton.addEventListener('click', handleBulkConversion);