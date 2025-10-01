// --- Configuration ---
// LIVE PRODUCTION API URL (Render Service)
// Current endpoints:
// Bulk Converter: API_BASE_URL + '/bulk-convert'
// CSV to JSON (PRO): API_BASE_URL + '/csv-to-json'
// JSON to SQL (PRO): API_BASE_URL + '/json-to-sql'
const API_BASE_URL = 'https://dataxlator-api.onrender.com'; 

// --- 1. DOM Element Selection ---
// Core Text Areas and Display
const inputData = document.getElementById('input-data');
const outputData = document.getElementById('output-data');
const directionDisplay = document.getElementById('direction-display');

// New Selectors for Conversion Direction and Execution
const inputFormatSelect = document.getElementById('input-format-select');
const outputFormatSelect = document.getElementById('output-format-select');
const executeConvertButton = document.getElementById('execute-convert');

// Bulk Converter Elements (PRO Feature)
const bulkFileInput = document.getElementById('bulk-file-input');
const bulkConvertButton = document.getElementById('bulk-convert-button');
const bulkMessage = document.getElementById('bulk-message');

// --- ANALYTICS FUNCTION ---
// A simple function to log important user actions to the console, 
// mimicking sending data to an analytics service like Google Analytics or PostHog.
function trackEvent(eventName, properties = {}) {
    console.log(`[ANALYTICS] Event: ${eventName}`, properties);
}

// --- CORE CONVERSION LOGIC ---

/**
 * Updates the direction display text based on the selected formats.
 * Also toggles the 'Convert' button to indicate PRO (server-side) vs. Free (client-side) features.
 * @param {string} inputFormat 
 * @param {string} outputFormat 
 */
function updateDirection(inputFormat, outputFormat) {
    directionDisplay.textContent = `${inputFormat} ➡️ ${outputFormat}`;
    
    // Check if the current conversion requires a server call (PRO feature)
    const isProFeature = 
        inputFormat === 'CSV' || 
        outputFormat === 'SQL' || 
        (inputFormat !== 'JSON' && inputFormat !== 'YAML') || 
        (outputFormat !== 'JSON' && outputFormat !== 'YAML');

    if (isProFeature) {
        // Change button color/text to indicate PRO/Server action
        executeConvertButton.textContent = 'Convert (PRO)';
        executeConvertButton.classList.remove('bg-green-600', 'hover:bg-green-700');
        executeConvertButton.classList.add('bg-yellow-600', 'hover:bg-yellow-700');
    } else {
        // Standard client-side conversion
        executeConvertButton.textContent = 'Convert';
        executeConvertButton.classList.remove('bg-yellow-600', 'hover:bg-yellow-700');
        executeConvertButton.classList.add('bg-green-600', 'hover:bg-green-700');
    }
}

/**
 * Handles all single-text conversion requests (both client-side and server-side PRO).
 */
async function translateData() {
    outputData.value = 'Processing...';
    const inputFormat = inputFormatSelect.value;
    const outputFormat = outputFormatSelect.value;
    const inputContent = inputData.value.trim();

    if (!inputContent) {
        outputData.value = '❌ Error: Input cannot be empty.';
        return;
    }

    // Check for client-side JSON <-> YAML conversion (FREE)
    if ((inputFormat === 'JSON' && outputFormat === 'YAML') || (inputFormat === 'YAML' && outputFormat === 'JSON')) {
        // --- CLIENT-SIDE JSON/YAML CONVERSION (FREE) ---
        try {
            // Use js-yaml library (loaded via CDN in index.html)
            const dataObject = inputFormat === 'JSON' ? JSON.parse(inputContent) : jsyaml.load(inputContent);
            let result;
            if (outputFormat === 'JSON') {
                result = JSON.stringify(dataObject, null, 2);
            } else { // outputFormat === 'YAML'
                result = jsyaml.dump(dataObject);
            }
            outputData.value = result;
        } catch (error) {
            outputData.value = `❌ Conversion Error: ${error.message}`;
        }
    } else {
        // --- SERVER-SIDE CONVERSION (PRO FEATURES: CSV/SQL) ---
        
        // ANALYTICS: Track attempt to use a paid feature
        trackEvent('PRO_Conversion_Attempt', { 
            input: inputFormat, 
            output: outputFormat 
        });

        let endpoint = '';
        if (inputFormat === 'CSV' && outputFormat === 'JSON') {
            endpoint = '/csv-to-json';
        } else if (inputFormat === 'JSON' && outputFormat === 'SQL') {
            endpoint = '/json-to-sql';
        } else {
            outputData.value = '❌ Error: Invalid or unsupported conversion path.';
            return;
        }

        try {
            const response = await fetch(API_BASE_URL + endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: inputContent })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API Error (${response.status}): ${errorText.substring(0, 100)}...`);
            }

            const resultJson = await response.json();
            // Server should return 'converted_data' field
            outputData.value = resultJson.converted_data || JSON.stringify(resultJson, null, 2);

        } catch (error) {
            outputData.value = `❌ Server Error: Could not complete conversion. ${error.message}`;
        }
    }
}

// --- BULK CONVERTER LOGIC (PRO) ---

async function bulkConvert() {
    const file = bulkFileInput.files[0];
    if (!file) {
        bulkMessage.textContent = 'Please select a ZIP file first.';
        return;
    }
    
    // ANALYTICS: Track Bulk Converter usage attempt
    trackEvent('PRO_Bulk_Conversion_Attempt', { 
        file_name: file.name 
    });

    bulkMessage.textContent = 'Uploading and Converting... This may take a moment.';
    const formData = new FormData();
    formData.append('zip_file', file);

    try {
        // Send ZIP file to the live Render API
        const response = await fetch(API_BASE_URL + '/bulk-convert', {
            method: 'POST',
            body: formData 
        });

        if (!response.ok) {
            throw new Error('Server returned an error during bulk conversion.');
        }

        // Handle the ZIP response
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'dataxlator_converted_files.zip';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        
        bulkMessage.textContent = '✅ Success! Converted ZIP downloaded.';
        
        // ANALYTICS: Track successful paid feature use
        trackEvent('PRO_Bulk_Conversion_Success');

    } catch (error) {
        bulkMessage.textContent = `❌ Conversion failed. Check API status. Error: ${error.message}`;
    }
}


// --- EVENT LISTENERS ---

// Listener for conversion selectors and input
inputFormatSelect.addEventListener('change', () => {
    updateDirection(inputFormatSelect.value, outputFormatSelect.value);
});
outputFormatSelect.addEventListener('change', () => {
    updateDirection(inputFormatSelect.value, outputFormatSelect.value);
});
inputData.addEventListener('input', () => {
    // If it's a client-side conversion (JSON/YAML), run it live on input change
    const inputFormat = inputFormatSelect.value;
    const outputFormat = outputFormatSelect.value;
    if ((inputFormat === 'JSON' && outputFormat === 'YAML') || (inputFormat === 'YAML' && outputFormat === 'JSON')) {
        translateData();
    }
});

// Listener for server-side Convert button
executeConvertButton.addEventListener('click', translateData);

// Listener for Bulk Converter button
bulkConvertButton.addEventListener('click', bulkConvert);

// Initial state setup on load
updateDirection(inputFormatSelect.value, outputFormatSelect.value);


// --- MONETIZATION ANALYTICS TRACKING ---

// Track clicks on all upgrade buttons by looking for the Stripe URL prefix
document.querySelectorAll('a[href*="buy.stripe.com"]').forEach(link => {
    link.addEventListener('click', (e) => {
        const url = e.currentTarget.href;
        let tier = 'Unknown';
        // Check specific payment links for tier identification
        if (url.includes('bJefZ95ax6nn5XBfUa0Ny00')) {
            tier = 'Pro_Monthly_$7';
        } else if (url.includes('fZu9AL32p8vv0DhfUa0Ny01')) {
            tier = 'Pro_Lifetime_$29';
        } else if (url.includes('9B6eV56eBaDD99N0Zg0Ny02')) {
            tier = 'Pro_Teams_$19_Monthly';
        }
        
        // ANALYTICS: Track the click on the monetization link
        trackEvent('CTA_Click_Upgrade_Button', { tier: tier });
    });
});