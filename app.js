// --- Configuration ---
// LIVE PRODUCTION API URL (Render Service)
// Current endpoints:
// Bulk Converter: API_BASE_URL + '/bulk-convert'
// CSV to JSON (PRO): API_BASE_URL + '/convert/csv-to-json'
// JSON to SQL (PRO): API_BASE_URL + '/convert/json-to-sql'
const API_BASE_URL = 'https://dataxlator-api.onrender.com'; 

// --- 1. DOM Element Selection ---
const inputData = document.getElementById('input-data');
const outputData = document.getElementById('output-data');
const executeConvertButton = document.getElementById('execute-convert');

// New Selectors for Conversion Direction
const inputFormatSelect = document.getElementById('input-format-select');
const outputFormatSelect = document.getElementById('output-format-select');
const directionDisplay = document.getElementById('direction-display');

// Bulk Converter Elements
const bulkFileInput = document.getElementById('bulk-file-input');
const bulkConvertButton = document.getElementById('bulk-convert-button');
const bulkMessage = document.getElementById('bulk-message');

// Internal state to track the conversion direction
let inputFormat = 'JSON';
let outputFormat = 'YAML';

// --- 2. State Management (Update Direction) ---

/**
 * Updates the conversion direction based on user selection in the dropdowns.
 */
function updateDirection() {
    inputFormat = inputFormatSelect.value;
    outputFormat = outputFormatSelect.value;
    
    // Update the visual arrow display
    directionDisplay.textContent = `${inputFormat} ➡️ ${outputFormat}`;

    // Update input placeholder text
    inputData.placeholder = `Paste ${inputFormat} data here...`;

    // Clear output and messages when direction changes
    outputData.value = '';
    outputData.placeholder = `Conversion set to ${inputFormat} ➡️ ${outputFormat}. Click Convert or paste data.`;
    bulkMessage.textContent = ''; 

    // The user must click the dedicated Convert button for server-side processing,
    // so we disable input listening for non-JSON/YAML free features.
    inputData.removeEventListener('input', translateData);
    if (isClientSideConversion(inputFormat, outputFormat)) {
        inputData.addEventListener('input', translateData);
    }
}

/**
 * Checks if the current conversion direction can be handled client-side (JSON ↔ YAML).
 */
function isClientSideConversion(inputFmt, outputFmt) {
    return (inputFmt === 'JSON' && outputFmt === 'YAML') || 
           (inputFmt === 'YAML' && outputFmt === 'JSON');
}

/**
 * Determines if the selected conversion is a PRO feature.
 */
function isProFeature(inputFmt, outputFmt) {
    // YAML ↔ JSON is free (client-side)
    if (isClientSideConversion(inputFmt, outputFmt)) return false;
    
    // All other defined conversions (CSV ↔ JSON, JSON ↔ SQL) are PRO (server-side)
    if (inputFmt === 'CSV' && outputFmt === 'JSON') return true;
    if (inputFmt === 'JSON' && outputFmt === 'SQL') return true;
    
    // Any other combination is currently unsupported
    return false;
}

// --- 3. Core Conversion Functionality (Handles both Free and PRO) ---

/**
 * Executes the conversion based on the current direction, using client-side or API.
 */
async function translateData() {
    const input = inputData.value.trim();
    outputData.value = ''; 
    
    if (!input) {
        outputData.placeholder = 'Input is empty. Please paste data to begin translation.';
        return;
    }

    if (isClientSideConversion(inputFormat, outputFormat)) {
        // --- FREE: Client-Side Conversion (JSON ↔ YAML) ---
        try {
            let data;
            let output;
            if (inputFormat === 'JSON') {
                data = JSON.parse(input);
                output = jsyaml.dump(data, { noCompatMode: true }); // jsyaml from CDN
            } else {
                data = jsyaml.load(input);
                output = JSON.stringify(data, null, 2);
            }
            outputData.value = output;

        } catch (e) {
            outputData.value = `❌ ERROR in parsing ${inputFormat}:\n\n${e.message}\n\nPlease check your input syntax carefully.`;
            console.error('DataXLator Translation Error:', e);
        }
    
    } else if (isProFeature(inputFormat, outputFormat)) {
        // --- PRO: Server-Side API Conversion (CSV, SQL) ---
        
        // In a real application, you would add a check here for subscription status.

        outputData.placeholder = '🔄 Converting via PRO API...';
        executeConvertButton.disabled = true;

        let apiUrl = '';
        if (inputFormat === 'CSV' && outputFormat === 'JSON') {
            apiUrl = API_BASE_URL + '/convert/csv-to-json';
        } else if (inputFormat === 'JSON' && outputFormat === 'SQL') {
            apiUrl = API_BASE_URL + '/convert/json-to-sql';
        }
        
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: input
            });
            
            if (response.ok) {
                const result = await response.json();
                outputData.value = result.result; // Expects { "result": "..." }
                outputData.placeholder = '✅ Conversion Complete.';

            } else {
                const errorResult = await response.json();
                outputData.value = `❌ API Error (${response.status}): ${errorResult.error || 'Unknown server error'}`;
            }

        } catch (error) {
            console.error('API Fetch Error:', error);
            outputData.value = `❌ Network Error: Could not connect to API at ${API_BASE_URL}.`;
        } finally {
            executeConvertButton.disabled = false;
        }

    } else {
        // Unsupported or invalid conversion path
        outputData.value = `⚠️ Conversion ${inputFormat} ➡️ ${outputFormat} is not currently supported.`;
    }
}

// --- 4. Bulk Conversion Functionality (PRO Feature Integration) ---

/**
 * Sends the ZIP file to the Python backend for bulk conversion and handles the resulting download.
 */
async function handleBulkConversion() {
    const file = bulkFileInput.files[0];

    // 1. Basic Validation
    
    if (!file) {
        bulkMessage.textContent = '❌ Please select a ZIP file.';
        return;
    }
    if (!file.name.toLowerCase().endsWith('.zip')) {
        bulkMessage.textContent = '❌ Only ZIP files are supported for bulk conversion.';
        return;
    }
    
    // In a real application, you would add a check here for subscription status.

    bulkMessage.textContent = '🔄 Uploading and converting...';
    bulkConvertButton.disabled = true;

    // 2. Prepare Form Data
    const formData = new FormData();
    formData.append('file', file);
    
    const apiUrl = API_BASE_URL + '/bulk-convert';

    try {
        // 3. Send Request to Flask Backend
        const response = await fetch(apiUrl, {
            method: 'POST',
            body: formData,
            // CORS must be enabled on the server (it is, using flask-cors)
        });

        if (response.ok) {
            // 4. Handle Successful ZIP Download
            bulkMessage.textContent = '✅ Conversion Complete! Starting download...';
            
            // Extract the filename from the server's response header
            let filename = 'dataxlator_converted_files.zip';
            const disposition = response.headers.get('Content-Disposition');
            if (disposition && disposition.indexOf('attachment') !== -1) {
                const matches = /filename="?([^"]*)"?/.exec(disposition);
                if (matches != null && matches[1]) filename = matches[1];
            }
            
            // Convert response stream to a Blob
            const blob = await response.blob();
            
            // Create a temporary link element to trigger the download
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename; // Use the filename from the server
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            
            // 5. Cleanup
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
        bulkMessage.textContent = `❌ Connection Error. Check the API_BASE_URL and server status.`;
    } finally {
        bulkConvertButton.disabled = false;
        // Re-enable input if needed, but keeping file input clear is usually better UX
    }
}

// --- 5. Event Listeners ---

// Conversion Direction Listeners
inputFormatSelect.addEventListener('change', updateDirection);
outputFormatSelect.addEventListener('change', updateDirection);

// Core Conversion Listener (Only triggered by button click for PRO features)
executeConvertButton.addEventListener('click', translateData);

// Bulk Feature Listener
bulkConvertButton.addEventListener('click', handleBulkConversion);

// Initialize the correct direction logic on load
updateDirection();