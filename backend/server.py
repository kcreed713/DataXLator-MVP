import io
import json
import zipfile
import yaml
import csv
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS 
from werkzeug.datastructures import FileStorage

app = Flask(__name__)

# Enable CORS explicitly for production deployment
# This allows your GitHub Pages frontend (kcreed713.github.io) to talk to the Render backend.
CORS(app, resources={r"/*": {"origins": "*"}}) 

# --- Configuration ---
# Set the maximum content length for uploads (e.g., 16 MB limit for the zip file)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024 

# --- Helper Functions for Conversion ---

def json_to_yaml(data_str):
    """Converts a JSON string to a YAML string."""
    data = json.loads(data_str)
    return yaml.safe_dump(data, default_flow_style=False)

def yaml_to_json(data_str):
    """Converts a YAML string to a JSON string (formatted with 2 spaces)."""
    data = yaml.safe_load(data_str)
    return json.dumps(data, indent=2)

def json_to_sql_insert(json_data_str, table_name="dataxlator_records"):
    """
    Converts a JSON array of objects to SQL INSERT statements.
    Uses backticks (`) for column and table names for safety.
    """
    data = json.loads(json_data_str)
    
    # Ensure data is an array of objects for SQL conversion
    if not isinstance(data, list) or not data:
        raise ValueError("JSON data must be a non-empty array of objects for SQL conversion.")
        
    columns = data[0].keys()
    # Use backticks for column names (e.g., `column_name`)
    columns_str = ", ".join([f"`{col}`" for col in columns])
    
    sql_statements = []
    
    for row in data:
        values = []
        for col in columns:
            value = row.get(col)
            if isinstance(value, str):
                # Escape single quotes and wrap in single quotes
                values.append(f"'{value.replace('\'', '\'\'')}'") 
            elif value is None:
                values.append('NULL')
            else:
                values.append(str(value)) # Numbers, Booleans (e.g., 1/0)
        
        values_str = ", ".join(values)
        # Use backticks for table name (e.g., `table_name`)
        sql = f"INSERT INTO `{table_name}` ({columns_str}) VALUES ({values_str});"
        sql_statements.append(sql)
        
    return "\n".join(sql_statements)

def csv_to_json(data_str):
    """Converts CSV string to a JSON array of objects (as a formatted string)."""
    f = io.StringIO(data_str)
    # DictReader automatically uses the first row as headers/keys
    reader = csv.DictReader(f)
    json_data = list(reader)
    
    # Check if any records were actually read
    if not json_data:
        raise ValueError("CSV contained headers but no data records.")
        
    return json.dumps(json_data, indent=2)

# --- Main API Route for Bulk Conversion (The Monetized Feature) ---

@app.route('/bulk-convert', methods=['POST'])
def bulk_convert():
    """
    Handles bulk conversion of files contained within an uploaded ZIP file.
    It attempts multiple conversion paths for high-value formats (JSON, CSV).
    """
    if 'zip_file' not in request.files:
        return jsonify({"error": "No ZIP file part in the request."}), 400

    uploaded_file = request.files['zip_file']

    if not uploaded_file.filename.lower().endswith('.zip'):
        return jsonify({"error": "File must be a ZIP archive."}), 400

    try:
        input_zip_buffer = io.BytesIO(uploaded_file.read())
        output_zip_buffer = io.BytesIO()
        
        file_count = 0
        
        with zipfile.ZipFile(input_zip_buffer, 'r') as input_zip:
            with zipfile.ZipFile(output_zip_buffer, 'w', zipfile.ZIP_DEFLATED) as output_zip:
                
                for filename in input_zip.namelist():
                    if filename.endswith('/') or filename.startswith('__MACOSX'):
                        continue
                    
                    file_count += 1
                    lower_filename = filename.lower()
                    
                    try:
                        with input_zip.open(filename) as file:
                            # Read content as UTF-8
                            content = file.read().decode('utf-8')
                            
                            # Dictionary to hold all successful conversions for the current file
                            conversions = {} 
                            
                            # --- Conversion Logic ---
                            if lower_filename.endswith(('.json')):
                                # 1. JSON -> YAML
                                conversions[filename.replace('.json', '.yaml')] = json_to_yaml(content)
                                
                                # 2. JSON -> SQL (requires array of objects structure)
                                try:
                                    conversions[filename.replace('.json', '.sql')] = json_to_sql_insert(content)
                                except ValueError as e:
                                    conversions[f"{filename.replace('.json', '')}_SQL_ERROR.txt"] = \
                                        f"Skipped JSON to SQL conversion: {str(e)}"
                                
                            elif lower_filename.endswith(('.yaml', '.yml')):
                                # 1. YAML -> JSON
                                new_filename = filename.replace('.yaml', '.json').replace('.yml', '.json')
                                conversions[new_filename] = yaml_to_json(content)

                            elif lower_filename.endswith(('.csv')):
                                # 1. CSV -> JSON (intermediate step)
                                json_content = csv_to_json(content)
                                conversions[filename.replace('.csv', '.json')] = json_content
                                
                                # 2. CSV -> SQL (uses the intermediate JSON content)
                                try:
                                    conversions[filename.replace('.csv', '.sql')] = json_to_sql_insert(json_content)
                                except Exception as e:
                                    conversions[f"{filename.replace('.csv', '')}_SQL_ERROR.txt"] = \
                                        f"Skipped CSV to SQL conversion: SQL generation failed after JSON conversion: {str(e)}"
                            
                            # Write all generated conversions to the output ZIP
                            if conversions:
                                for new_filename, converted_content in conversions.items():
                                    output_zip.writestr(new_filename, converted_content.encode('utf-8'))
                            else:
                                # Write a skip file if the format was unrecognized
                                output_zip.writestr(f"{filename}_SKIP.txt", f"No conversion path found for file type: {lower_filename.split('.')[-1]}".encode('utf-8'))
                                
                    except Exception as e:
                        # Catch file-specific errors (e.g., decoding, parsing)
                        error_message = f"ERROR processing {filename}: {str(e)}"
                        print(error_message)
                        output_zip.writestr(f"{filename}_BATCH_ERROR.txt", error_message.encode('utf-8'))

                if file_count == 0:
                    return jsonify({"error": "ZIP file contained no recognizable files."}), 400

        # Prepare buffer for response
        output_zip_buffer.seek(0)
        
        # Send the new ZIP file back to the client
        return send_file(
            output_zip_buffer,
            mimetype='application/zip',
            as_attachment=True,
            download_name='dataxlator_converted_files.zip'
        )

    except zipfile.BadZipFile:
        return jsonify({"error": "The uploaded file is not a valid ZIP archive."}), 400
    except Exception as e:
        print(f"Critical server-side error during bulk conversion: {e}")
        return jsonify({"error": "An internal server error occurred during processing."}), 500

if __name__ == '__main__':
    # Use for local testing only
    app.run(debug=True, port=5000)