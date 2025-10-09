import io
import json
import zipfile
import yaml
import csv
from collections import OrderedDict # New import for guaranteed key order
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS 
from werkzeug.datastructures import FileStorage

app = Flask(__name__)

# Enable CORS explicitly for production deployment
CORS(app, resources={r"/*": {"origins": "*"}}) 

# --- Configuration ---
# Set the maximum content length for uploads (e.g., 16 MB limit for the zip file)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024 

# --- Custom Dumper for YAML (Fixes Sorting) ---
# NOTE: The explicit use of OrderedDict below makes this custom dumper largely redundant, 
# but we keep the structure clean for compatibility. We still need to register it.
class NoAliasSafeDumper(yaml.SafeDumper):
    """Custom YAML Dumper to prevent aliases and preserve dictionary key order."""
    pass

# FIX 1: Register a function to represent standard Python dicts AND OrderedDict.
def dict_representer(dumper, data):
    # This represents the dictionary keys in the order they are iterated (insertion order for OrderedDict/modern dict)
    return dumper.represent_mapping('tag:yaml.org,2002:map', data.items())

NoAliasSafeDumper.add_representer(dict, dict_representer)
NoAliasSafeDumper.add_representer(OrderedDict, dict_representer)


# --- Helper Functions for Conversion ---

def json_to_yaml(data_str):
    """Converts a JSON string to a YAML string, preserving key order."""
    # FIX 1: Use object_pairs_hook=OrderedDict to load JSON with guaranteed order
    data = json.loads(data_str, object_pairs_hook=OrderedDict)
    # Use the custom Dumper class. The OrderedDict and the custom Dumper registration 
    # handle order preservation, so we remove the potentially conflicting sort_keys=False argument.
    return yaml.dump(data, Dumper=NoAliasSafeDumper, default_flow_style=False)

def yaml_to_json(data_str):
    """Converts a YAML string to a JSON string (formatted with 2 spaces)."""
    data = yaml.safe_load(data_str)
    return json.dumps(data, indent=2)

def json_to_sql_insert(json_data_str, table_name="your_table"):
    """
    Converts a JSON string (can be a single object or an array of objects) 
    to SQL INSERT statements. Handles nested objects/arrays and single records.
    """
    # FIX 2: Use OrderedDict for robust parsing of single records
    data = json.loads(json_data_str, object_pairs_hook=OrderedDict)
    
    # FIX 2: If data is a dictionary (single record), wrap it in a list.
    # This handles both standard dicts and OrderedDicts used during parsing.
    if isinstance(data, dict):
        data = [data]
    
    # Check if we have a non-empty list of records
    if not isinstance(data, list) or not data:
        raise ValueError("JSON data must be a non-empty object or array of objects.")
    
    # Check for empty record (e.g., if input was [{}])
    if not data[0].keys():
         raise ValueError("JSON record is empty and cannot be converted to SQL columns.")
        
    columns = data[0].keys()
    # The columns are now guaranteed to be in the original insertion order
    columns_str = ", ".join([f"`{c}`" for c in columns])
    
    sql_statements = []
    
    for row in data:
        values = []
        # row is now an OrderedDict, so iteration order is correct
        for col in columns:
            value = row.get(col)
            if isinstance(value, str):
                # Handle simple strings: escape single quotes and wrap in SQL quotes
                values.append(f"'{value.replace('\'', '\'\'')}'") 
            elif isinstance(value, (dict, list)):
                # Handle nested objects/arrays by stringifying them into JSON before SQL
                json_value = json.dumps(value)
                values.append(f"'{json_value.replace('\'', '\'\'')}'")
            elif value is None:
                values.append('NULL')
            else:
                values.append(str(value))
        
        values_str = ", ".join(values)
        sql = f"INSERT INTO `{table_name}` ({columns_str}) VALUES ({values_str});"
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
                    converted_content_sql = None
                    new_filename = None
                    new_filename_sql = None
                    convert_type = None

                    try:
                        with input_zip.open(filename) as file:
                            content = file.read().decode('utf-8')
                            
                            file_count += 1
                            
                            lower_filename = filename.lower()
                            
                            # --- Conversion Logic ---
                            if lower_filename.endswith(('.json')):
                                # JSON -> YAML conversion (Primary conversion)
                                converted_content = json_to_yaml(content)
                                new_filename = filename.replace('.json', '.yaml')
                                convert_type = 'JSON_TO_YAML'
                                
                                # JSON -> SQL conversion (Secondary conversion)
                                try:
                                    converted_content_sql = json_to_sql_insert(content)
                                    new_filename_sql = filename.replace('.json', '.sql')
                                except Exception as sql_e:
                                    # This should only skip if the JSON is a primitive (not object/array)
                                    print(f"Skipped JSON to SQL conversion for {filename}: {str(sql_e)}")
                                    pass

                            elif lower_filename.endswith(('.yaml', '.yml')):
                                # YAML to JSON conversion
                                converted_content = yaml_to_json(content)
                                new_filename = filename.replace('.yaml', '.json').replace('.yml', '.json')
                                convert_type = 'YAML_TO_JSON'

                            elif lower_filename.endswith(('.csv')):
                                # CSV to JSON conversion (Primary conversion)
                                json_content = csv_to_json(content)
                                converted_content = json_content
                                new_filename = filename.replace('.csv', '.json')
                                convert_type = 'CSV_TO_JSON'
                                
                                # CSV to SQL conversion (Secondary conversion)
                                try:
                                    converted_content_sql = json_to_sql_insert(json_content)
                                    new_filename_sql = filename.replace('.csv', '.sql')
                                except Exception as sql_e:
                                     print(f"Skipped CSV to SQL conversion for {filename}: {str(sql_e)}")
                                     pass
                            # --- End Conversion Logic ---
                            
                    except Exception as e:
                        # Write an error file instead of crashing the batch
                        error_message = f"ERROR converting {filename} (Type: {convert_type or 'Unknown'}): {str(e)}"
                        print(error_message)
                        new_filename = f"{filename}_ERROR.txt"
                        converted_content = error_message
                        
                    # Write the primary converted or error content to the output ZIP
                    if converted_content and new_filename:
                        output_zip.writestr(new_filename, converted_content.encode('utf-8'))

                    # Write the secondary SQL content to the output ZIP, if generated
                    if converted_content_sql and new_filename_sql:
                         output_zip.writestr(new_filename_sql, converted_content_sql.encode('utf-8'))


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