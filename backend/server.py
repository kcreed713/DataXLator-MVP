import io
import json
import zipfile
import yaml
import csv
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS 
from werkzeug.datastructures import FileStorage

app = Flask(__name__)

# Enable CORS (critical for client-side JS)
CORS(app) 

# --- Configuration ---
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

def json_to_sql_insert(json_data_str, table_name="your_table"):
    """Converts a JSON array of objects to SQL INSERT statements."""
    data = json.loads(json_data_str)
    
    if not isinstance(data, list) or not data:
        raise ValueError("JSON data must be a non-empty array of objects.")
        
    columns = data[0].keys()
    columns_str = ", ".join(columns)
    
    sql_statements = []
    
    for row in data:
        values = []
        for col in columns:
            value = row.get(col)
            if isinstance(value, str):
                # FIX: Corrected quote escaping syntax for Python f-string
                values.append(f"'{value.replace('\'', '\'\'')}'") 
            elif value is None:
                values.append('NULL')
            else:
                values.append(str(value))
        
        values_str = ", ".join(values)
        sql = f"INSERT INTO {table_name} ({columns_str}) VALUES ({values_str});"
        sql_statements.append(sql)
        
    return "\n".join(sql_statements)

def csv_to_json(data_str):
    """Converts CSV string to a JSON array of objects."""
    f = io.StringIO(data_str)
    reader = csv.DictReader(f)
    json_data = list(reader)
    return json.dumps(json_data, indent=2)

# --- Main API Route for Bulk Conversion (The Monetized Feature) ---

@app.route('/bulk-convert', methods=['POST'])
def bulk_convert():
    """
    Handles bulk conversion of files contained within an uploaded ZIP file.
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
                    if filename.endswith('/'):
                        continue
                    
                    converted_content = None
                    new_filename = None
                    convert_type = None

                    try:
                        with input_zip.open(filename) as file:
                            content = file.read().decode('utf-8')
                            
                            file_count += 1
                            
                            lower_filename = filename.lower()
                            
                            # --- Conversion Logic ---
                            if lower_filename.endswith(('.json')):
                                # Try JSON to YAML
                                try:
                                    # We try JSON->YAML first, as it's the default
                                    converted_content = json_to_yaml(content)
                                    new_filename = filename.replace('.json', '.yaml')
                                    convert_type = 'JSON_TO_YAML'
                                except:
                                    # If JSON->YAML fails (e.g., if it's an array of objects), try JSON->SQL
                                    converted_content = json_to_sql_insert(content)
                                    new_filename = filename.replace('.json', '.sql')
                                    convert_type = 'JSON_TO_SQL'
                                
                            elif lower_filename.endswith(('.yaml', '.yml')):
                                # YAML to JSON conversion
                                converted_content = yaml_to_json(content)
                                new_filename = filename.replace('.yaml', '.json').replace('.yml', '.json')
                                convert_type = 'YAML_TO_JSON'

                            elif lower_filename.endswith(('.csv')):
                                # CSV to JSON conversion
                                converted_content = csv_to_json(content)
                                new_filename = filename.replace('.csv', '.json')
                                convert_type = 'CSV_TO_JSON'
                            # --- End Conversion Logic ---
                            
                    except Exception as e:
                        # Write an error file instead of crashing the batch
                        error_message = f"ERROR converting {filename} (Type: {convert_type or 'Unknown'}): {str(e)}"
                        print(error_message)
                        new_filename = f"{filename}_ERROR.txt"
                        converted_content = error_message
                        
                    # Write the converted or error content to the output ZIP
                    if converted_content:
                        output_zip.writestr(new_filename, converted_content.encode('utf-8'))

                if file_count == 0:
                    return jsonify({"error": "ZIP file contained no recognizable files (.json, .yaml, .yml, .csv)"}), 400

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
        print(f"Server-side error during bulk conversion: {e}")
        return jsonify({"error": "An internal server error occurred during processing."}), 500

if __name__ == '__main__':
    # Use for local testing only
    app.run(debug=True, port=5000)