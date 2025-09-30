import io
import json
import zipfile
import yaml
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS # NEW: Import CORS module
from werkzeug.datastructures import FileStorage

app = Flask(__name__)

# NEW: Enable CORS for all routes (necessary for client-side JS on GitHub Pages to talk to localhost)
# For production deployment, you would restrict this to your specific domain (e.g., origins="https://your-username.github.io")
CORS(app) 

# --- Configuration ---
# Set the maximum content length for uploads (e.g., 16 MB limit for the zip file)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024 

# --- Helper Functions for Conversion ---

def json_to_yaml(data_str):
    """Converts a JSON string to a YAML string."""
    data = json.loads(data_str)
    # Using safe_dump ensures only standard Python objects are serialized
    return yaml.safe_dump(data, default_flow_style=False)

def yaml_to_json(data_str):
    """Converts a YAML string to a JSON string (formatted with 2 spaces)."""
    # Use safe_load to prevent arbitrary code execution from malicious YAML
    data = yaml.safe_load(data_str)
    return json.dumps(data, indent=2)

# --- Core API Endpoint ---

@app.route('/bulk-convert', methods=['POST'])
def bulk_convert():
    """
    Handles the zip file upload, processes all files inside, and returns a converted zip.
    """
    if 'file' not in request.files:
        return jsonify({"error": "No file part in the request"}), 400

    file: FileStorage = request.files['file']
    
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    # Ensure the uploaded file is a zip
    if not file.filename.endswith('.zip'):
        return jsonify({"error": "Only ZIP files are supported for bulk conversion"}), 400

    # Create in-memory buffer for the output ZIP file
    output_zip_buffer = io.BytesIO()

    try:
        # Read the input ZIP file into an in-memory buffer
        input_zip_buffer = io.BytesIO(file.read())
        
        # Open the input ZIP and output ZIP files
        with zipfile.ZipFile(input_zip_buffer, 'r') as input_zip, \
             zipfile.ZipFile(output_zip_buffer, 'w', zipfile.ZIP_DEFLATED) as output_zip:

            file_count = 0
            for filename in input_zip.namelist():
                # Skip directories and non-config files
                if filename.endswith('/') or not (filename.endswith('.json') or filename.endswith('.yaml') or filename.endswith('.yml')):
                    continue
                
                file_count += 1
                
                # 1. Read the file content
                with input_zip.open(filename) as source_file:
                    content_bytes = source_file.read()
                    content_str = content_bytes.decode('utf-8')
                
                converted_content = None
                new_filename = filename
                
                # 2. Determine conversion direction and execute
                try:
                    if filename.endswith('.json'):
                        # JSON -> YAML
                        converted_content = json_to_yaml(content_str)
                        new_filename = filename.replace('.json', '.yaml')
                        
                    elif filename.endswith(('.yaml', '.yml')):
                        # YAML -> JSON
                        converted_content = yaml_to_json(content_str)
                        # Ensure we convert .yaml or .yml to .json
                        if filename.endswith('.yml'):
                            new_filename = filename.replace('.yml', '.json')
                        else:
                            new_filename = filename.replace('.yaml', '.json')
                            
                except Exception as e:
                    # Write an error file instead of crashing the batch
                    error_message = f"ERROR converting {filename}: {str(e)}"
                    print(error_message)
                    new_filename = f"{filename}_ERROR.txt"
                    converted_content = error_message
                    
                # 3. Write the converted or error content to the output ZIP
                if converted_content:
                    output_zip.writestr(new_filename, converted_content.encode('utf-8'))

            if file_count == 0:
                return jsonify({"error": "ZIP file contained no recognizable JSON or YAML files (.json, .yaml, .yml)"}), 400

        # Prepare buffer for response
        output_zip_buffer.seek(0)
        
        # 4. Send the new ZIP file back to the client
        return send_file(
            output_zip_buffer,
            mimetype='application/zip',
            as_attachment=True,
            download_name='dataxlator_converted_files.zip'
        )

    except zipfile.BadZipFile:
        return jsonify({"error": "The uploaded file is not a valid ZIP archive."}), 400
    except Exception as e:
        print(f"Server-side error during bulk conversion: {e}")
        return jsonify({"error": "An internal server error occurred during processing."}), 500

if __name__ == '__main__':
    # Use for local testing only
    app.run(debug=True, port=5000)