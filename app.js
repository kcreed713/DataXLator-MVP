// --- 1. DOM Element Selection ---
const inputData = document.getElementById('input-data');
const outputData = document.getElementById('output-data');
const convertButton = document.getElementById('convert-button');

// --- 2. Conversion Functionality ---

/**
 * Executes the conversion based on the current direction.
 */
function translateData() {
    const direction = convertButton.getAttribute('data-direction');
    const input = inputData.value.trim();
    outputData.value = ''; // Clear previous output
    
    if (!input) {
        outputData.placeholder = 'Paste data into the input box to translate.';
        return;
    }

    try {
        if (direction === 'json-to-yaml') {
            // JSON -> YAML
            const data = JSON.parse(input);
            // The yaml.dump method is provided by the js-yaml library
            outputData.value = jsyaml.dump(data);
        } else {
            // YAML -> JSON
            // The yaml.load method is provided by the js-yaml library
            const data = jsyaml.load(input);
            // Use JSON.stringify for clean, readable output (2-space indent)
            outputData.value = JSON.stringify(data, null, 2);
        }
    } catch (e) {
        // Simple error handling for bad input format
        outputData.value = `ERROR: Invalid input format for ${direction === 'json-to-yaml' ? 'JSON' : 'YAML'}.\n\nPlease check your syntax.`;
        console.error('Translation Error:', e);
    }
}

/**
 * Toggles the conversion direction and updates the button text.
 */
function toggleDirection() {
    const currentDir = convertButton.getAttribute('data-direction');
    
    if (currentDir === 'json-to-yaml') {
        convertButton.setAttribute('data-direction', 'yaml-to-json');
        convertButton.textContent = 'Convert: YAML → JSON';
    } else {
        convertButton.setAttribute('data-direction', 'json-to-yaml');
        convertButton.textContent = 'Convert: JSON → YAML';
    }
    
    // Clear the output when direction changes to prompt re-translation
    outputData.value = '';
    outputData.placeholder = 'Conversion direction changed. Press "Convert" to translate the existing input.';
}

// --- 3. Event Listeners ---

// 1. Convert button listener (handles the translation)
convertButton.addEventListener('click', translateData);

// 2. Input change listener (automatically converts as the user types)
// Optional: Using 'input' for live updates. If performance is an issue, we can remove this.
inputData.addEventListener('input', translateData);

// 3. Direction toggle functionality (same button also acts as the toggle)
// We'll let the 'click' handler on the button handle the conversion, 
// so we'll need a way to **just** toggle the direction too,
// perhaps a separate small button or a double-click handler on the input itself. 
// For simplicity and clarity right now, let's keep the single button focused on CONVERSION.
// The user can edit the input and click 'Convert' again.

// LATER REFINEMENT: A dedicated 'Toggle Direction' button would improve UX.