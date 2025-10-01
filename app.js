// --- Configuration ---
// IMPORTANT: Change this URL when deploying your Flask server to a production environment (e.g., AWS, GCP).
const BULK_API_URL = 'http://localhost:5000/bulk-convert'; // Default for local Python Flask testing

// --- 1. DOM Element Selection ---
const inputData = document.getElementById('input-data');
const outputData = document.getElementById('output-data');
const executeConvertButton = document.getElementById('execute-convert');
const swapButton = document.getElementById('swap-button');
const directionDisplay = document.getElementById('direction-display');

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
    outputData.placeholder = 'Conversion direction swapped. Paste new data or click Convert.';
}

// --- 3. Core Conversion Functionality (Free Feature) ---

/**
 * Executes the free, single-data conversion based on the current direction state.
 */
function translateData() {
    const input = inputData.value.trim();
    outputData.value = ''; 
    
    if (!input) {
        outputData.placeholder = 'Input is empty. Please paste data to begin translation.';
        return;
    }

    try {
        let data;
        let output;

        if (conversionDirection === 'json-to-yaml') {
            // JSON -> YAML Conversion
            data = JSON.parse(input);
            // jsyaml is loaded via CDN in index.html
            output = jsyaml.dump(data, { noCompatMode: true });

        } else {
            // YAML -> JSON Conversion
            data = jsyaml.load(input);
            output = JSON.stringify(data, null, 2);
        }
        
        outputData.value = output;

    } catch (e) {
        const inputType = conversionDirection === 'json-to-yaml' ? 'JSON' : 'YAML';
        outputData.value = `❌ ERROR in parsing ${inputType}:\n\n${e.message}\n\nPlease check your input syntax carefully.`;
        console.error('DataXLator Translation Error:', e);
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
    // For now, we assume the user is Pro to test the feature.

    bulkMessage.textContent = '🔄 Uploading and converting...';
    bulkConvertButton.disabled = true;

    // 2. Prepare Form Data
    const formData = new FormData();
    formData.append('file', file);

    try {
        // 3. Send Request to Flask Backend
        const response = await fetch(BULK_API_URL, {
            method: 'POST',
            body: formData,
            // CORS Note: Flask server must be configured to allow CORS from your GitHub Pages domain.
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
        bulkMessage.textContent = `❌ Connection Error. Is the backend server running at ${BULK_API_URL}?`;
    } finally {
        bulkConvertButton.disabled = false;
        // Re-enable input if needed, but keeping file input clear is usually better UX
    }
}

// --- 5. Event Listeners ---

// Free Feature Listeners
swapButton.addEventListener('click', toggleDirection);
executeConvertButton.addEventListener('click', translateData);
inputData.addEventListener('input', translateData);

// Pro Feature Listener
bulkConvertButton.addEventListener('click', handleBulkConversion);