// DataXLator Core Logic with Analytics Integration

// --- Configuration ---
// LIVE PRODUCTION API URL (Render Service)
const API_BASE_URL = 'https://dataxlator-api.onrender.com';

// --- 1. DOM Element Selection ---
const inputData = document.getElementById('input-data');
const outputData = document.getElementById('output-data');
const executeConvertButton = document.getElementById('execute-convert');
const bulkConvertButton = document.getElementById('bulk-convert');

// New Selectors for Conversion Direction
const fromFormatSelect = document.getElementById('from-format');
const toFormatSelect = document.getElementById('to-format');
const conversionHeader = document.getElementById('conversion-header');
const bulkMessage = document.getElementById('bulk-message');

// --- 2. Analytics Tracking ---
function trackEvent(eventName, properties = {}) {
    // --- ANALYTICS DECISION POINT ---
    // For launch, we are using console.log. Replace with your preferred SDK later.
    console.log(`[XLATOR_EVENT] ${eventName}`, properties);
}

// --- 3. Core Conversion Logic ---

// Determines the conversion direction and updates the UI
function setDirection() {
    const fromFormat = fromFormatSelect.value;
    const toFormat = toFormatSelect.value;

    conversionHeader.textContent = `${fromFormat} ➡️ ${toFormat}`;

    // Disable conversion for same formats
    if (fromFormat === toFormat) {
        outputData.value = 'Please select two different formats for conversion.';
        executeConvertButton.disabled = true;
    } else {
        executeConvertButton.disabled = false;
        // Trigger conversion automatically on direction change if input exists
        if (inputData.value.trim().length > 0) {
            translateData();
        }
    }
}

// Main function to handle all single-text conversions (Client-side and Server-side)
async function translateData() {
    const input = inputData.value.trim();
    if (input.length === 0) {
        outputData.value = '';
        return;
    }

    const fromFormat = fromFormatSelect.value;
    const toFormat = toFormatSelect.value;

    let convertedResult = '';
    let apiEndpoint = null;
    let conversionType = `${fromFormat}_to_${toFormat}`;

    // 1. Determine Conversion Type and Endpoint
    if (fromFormat === 'JSON' && toFormat === 'YAML') {
        // Client-side: JSON -> YAML (Requires jsyaml library from index.html)
        try {
            const data = JSON.parse(input);
            convertedResult = jsyaml.dump(data, { indent: 2, sortKeys: false });
        } catch (e) {
            convertedResult = `❌ JSON Parsing Error: ${e.message}`;
        }
    } else if (fromFormat === 'YAML' && toFormat === 'JSON') {
        // Client-side: YAML -> JSON (Requires jsyaml library from index.html)
        try {
            const data = jsyaml.load(input);
            convertedResult = JSON.stringify(data, null, 2);
        } catch (e) {
            convertedResult = `❌ YAML Parsing Error: ${e.message}`;
        }
    } else {
        // Server-side (PRO) Conversions
        if (conversionType === 'CSV_to_JSON') {
            apiEndpoint = '/convert/csv-to-json';
            trackEvent('PRO_Conversion_Attempt', { type: conversionType });
        } else if (conversionType === 'JSON_to_SQL') {
            apiEndpoint = '/convert/json-to-sql';
            trackEvent('PRO_Conversion_Attempt', { type: conversionType });
        } else {
            // All other complex conversions are currently unsupported in MVP
            convertedResult = `❌ Pro Feature: Conversion ${conversionType} not supported yet.`;
        }


        if (apiEndpoint) {
            outputData.value = 'Connecting to Pro API...';
            try {
                const response = await fetch(`${API_BASE_URL}${apiEndpoint}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ data: input }),
                });

                if (response.ok) {
                    // JSON to SQL returns plain text, others return JSON
                    if (apiEndpoint === '/convert/json-to-sql') {
                        convertedResult = await response.text();
                    } else {
                        const jsonResponse = await response.json();
                        convertedResult = JSON.stringify(jsonResponse, null, 2);
                    }
                } else {
                    const errorJson = await response.json();
                    convertedResult = `❌ Pro Conversion Failed (${response.status}): ${errorJson.error || 'Unknown server error.'}`;
                    trackEvent('PRO_Conversion_Failed', { type: conversionType, status: response.status });
                }
            } catch (e) {
                convertedResult = `❌ Network Error: Could not reach the API.`;
                trackEvent('PRO_Conversion_Failed', { type: conversionType, error: e.message });
            }
        }
    }

    // 2. Display Result
    outputData.value = convertedResult;
}


// --- 4. Bulk Conversion Logic (Server-side) ---

async function bulkConvert() {
    const fileInput = document.getElementById('bulk-file-input');
    const file = fileInput.files[0];

    if (!file) {
        bulkMessage.textContent = 'Please select a ZIP file.';
        return;
    }

    bulkMessage.textContent = 'Processing... Please wait (up to 30 seconds for large files).';

    const formData = new FormData();
    // CRITICAL: The API expects the file to be named 'file'
    formData.append('file', file);
    
    trackEvent('PRO_Bulk_Conversion_Attempt', { status: 'Starting' });

    try {
        const response = await fetch(`${API_BASE_URL}/bulk-convert`, {
            method: 'POST',
            body: formData,
        });

        if (response.ok) {
            // Successful response returns a blob (the ZIP file)
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = 'dataxlator_converted_files.zip';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            
            bulkMessage.textContent = '✅ Conversion successful! Download started.';
            trackEvent('PRO_Bulk_Conversion_Success', { size: file.size });

        } else {
            // Server error response (e.g., 400 Bad Request, 500 Internal Server Error)
            const errorText = await response.text();
            let errorMessage = `Server returned status ${response.status}.`;
            try {
                // Try to parse the error message if the server sent JSON
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error || errorMessage;
            } catch (e) {
                // If it's not JSON, use the raw text
                errorMessage = errorText;
            }

            bulkMessage.textContent = `❌ Conversion failed. Error: ${errorMessage}`;
            trackEvent('PRO_Bulk_Conversion_Failed', { status: response.status, error: errorMessage });
        }
    } catch (e) {
        // Network or fetch error
        bulkMessage.textContent = `❌ Network Error: Could not connect to API.`;
        trackEvent('PRO_Bulk_Conversion_Failed', { error: e.message });
    }
}

// --- 5. Event Listeners ---

// Listeners for Conversion Direction Change
fromFormatSelect.addEventListener('change', setDirection);
toFormatSelect.addEventListener('change', setDirection);

// Listener for Execute Convert button (triggers single-text conversion)
executeConvertButton.addEventListener('click', translateData);

// Listener for Bulk Converter button (triggers file upload)
bulkConvertButton.addEventListener('click', bulkConvert);


// Listener for input data changes (triggers automatic re-conversion)
inputData.addEventListener('input', translateData);


// Initial setup on load
window.onload = () => {
    setDirection();
};