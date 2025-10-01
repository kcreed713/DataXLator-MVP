// --- Configuration ---

// IMPORTANT: This URL has been updated to your Render deployment.
const BULK_API_URL = 'https://dataxlator-api.onrender.com/bulk-convert';

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
 * Executes the conversion of data based on the current direction.
 */
function translateData() {
    outputData.classList.remove('error');
    const data = inputData.value.trim();
    if (!data) {
        outputData.value = '';
        return;
    }

    try {

        // Since we import js-yaml in index.html, we use it here for the free tier.
        // Since the free conversion is done purely in the browser, we use built-in functions
        if (conversionDirection === 'json-to-yaml') {
            const jsonObject = JSON.parse(data);
            // FIX: Using jsyaml.dump() for actual JSON -> YAML conversion
            outputData.value = jsyaml.dump(jsonObject); 
        } else { // yaml-to-json
            // FIX: Using jsyaml.load() for actual YAML -> JSON conversion
            const yamlObject = jsyaml.load(data);
            outputData.value = JSON.stringify(yamlObject, null, 2);
        }
    } catch (e) {
        outputData.value = `Error: Invalid ${conversionDirection === 'json-to-yaml' ? 'JSON' : 'YAML'} format.`;
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
    if (!file.name.toLowerCase().endsWith('.zip')) {
        bulkMessage.textContent = '❌ Only ZIP files are supported for bulk conversion.';
        return;
    }
    
    // In a real application, you would add a check here for subscription status.
    // For now, we assume the user is Pro to test the feature.


    const zipFile = files[0];
    const formData = new FormData();
    formData.append('zip_file', zipFile);
    
    // Add tracking for the conversion attempt
    trackEvent('PRO_Bulk_Conversion_Attempt', { conversion: conversionDirection });

    // Set UI state for loading
    bulkConvertButton.disabled = true;
    bulkMessage.textContent = 'Processing files... please wait (up to 30 seconds for large files).';
    
    try {
        // 3. Send Request to Flask Backend
        const response = await fetch(BULK_API_URL, {
            method: 'POST',
            body: formData,
            // CORS Note: Flask server must be configured to allow CORS from your GitHub Pages domain.
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

// --- 6. Event Listeners ---

// Free Feature Listeners
swapButton.addEventListener('click', toggleDirection);
executeConvertButton.addEventListener('click', translateData);
inputData.addEventListener('input', translateData);

// Pro Feature Listener
bulkConvertButton.addEventListener('click', handleBulkConversion);