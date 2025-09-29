// --- 1. DOM Element Selection & State ---
const inputData = document.getElementById('input-data');
const outputData = document.getElementById('output-data');
const executeConvertButton = document.getElementById('execute-convert');
const swapButton = document.getElementById('swap-button');
const directionDisplay = document.getElementById('direction-display');

// Internal state to track the conversion direction
let conversionDirection = 'json-to-yaml'; 

// --- 2. State Management (UX Improvement) ---

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
    // Clear output when direction changes for clarity
    outputData.value = '';
    outputData.placeholder = 'Conversion direction swapped. Ready to convert.';
}

// --- 3. Conversion Functionality ---

/**
 * Executes the conversion based on the current direction state.
 */
function translateData() {
    const input = inputData.value.trim();
    outputData.value = ''; // Clear previous output
    
    if (!input) {
        outputData.placeholder = 'Input is empty. Please paste data to begin translation.';
        return;
    }

    try {
        if (conversionDirection === 'json-to-yaml') {
            // JSON -> YAML
            // 1. Parse the JSON string into a JavaScript object
            const data = JSON.parse(input);
            // 2. Use js-yaml's dump method to convert the object to YAML
            outputData.value = jsyaml.dump(data);

        } else {
            // YAML -> JSON
            // 1. Use js-yaml's load method to convert the YAML string into a JavaScript object
            const data = jsyaml.load(input);
            // 2. Use JSON.stringify for clean, readable JSON output (2-space indent)
            outputData.value = JSON.stringify(data, null, 2);
        }

    } catch (e) {
        // Display a clear error message in the output area
        const inputType = conversionDirection === 'json-to-yaml' ? 'JSON' : 'YAML';
        outputData.value = `ERROR: Invalid input format for ${inputType}.\n\nPlease check your syntax.`;
        
        // Optional: Log detailed error to console
        console.error('Translation Error:', e);
    }
}

// --- 4. Event Listeners ---

// 1. Dedicated Swap Button Listener
swapButton.addEventListener('click', toggleDirection);

// 2. Execute Convert Button Listener
executeConvertButton.addEventListener('click', translateData);

// 3. Optional: Live input update (converts immediately as user types)
// NOTE: This can be resource intensive for very large files. 
// We include it here for a better user experience on typical config files.
inputData.addEventListener('input', translateData);

// Set initial placeholder text based on the default direction
inputData.placeholder = 'Paste JSON data here...';
