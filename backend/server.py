# DataXLator Backend API Server (Flask)
# LIVE API Base URL: https://dataxlator-api.onrender.com
# Handles PRO features: Bulk ZIP conversion, CSV-to-JSON, and JSON-to-SQL.

import os
import json
import yaml
import io
import zipfile
import csv
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename

# --- Configuration ---
app = Flask(__name__)
# Enable CORS for all origins (*) to allow requests from the statically hosted frontend
CORS(app)

# --- Utility Functions ---

def convert_json_to_sql(json_data):
    """Converts a list of JSON objects (records) into SQL INSERT statements."""
    if not isinstance(json_data, list) or not json_data:
        raise ValueError("Input must be a non-empty list of objects for SQL conversion.")

    # Assume all objects have the same keys for column names
    columns = list(json_data[0].keys())
    # Simple table name placeholder
    table_name = "dataxlator_table" 

    # Prepare column list for the INSERT statement
    column_list = ", ".join(f"`{col}`" for col in columns)

    # Generate INSERT statements for each record
    insert_statements = []
    for record in json_data:
        values = []
        for col in columns:
            value = record.get(col)
            # Handle Python types and escape strings for SQL
            if isinstance(value, str):
                # Escape single quotes and wrap in single quotes for SQL string literal
                values.append(f"'{value.replace("'", "''")}'")
            elif value is None:
                values.append("NULL")
            else:
                values.append(str(value)) # Numbers, booleans (as 0/1)

        values_list = ", ".join(values)
        sql = f"INSERT INTO {table_name} ({column_list}) VALUES ({values_list});"
        insert_statements.append(sql)
    
    return "\n".join(insert_statements)

# --- Conversion Endpoints (PRO Features) ---

@app.route('/convert/csv-to-json', methods=['POST'])
def csv_to_json_route():
    """Converts CSV text payload to JSON array."""
    try:
        data = request.get_json()
        csv_text = data.get('data', '')
        
        if not csv_text:
            return jsonify({"error": "No CSV data provided."}), 400

        # Use StringIO to treat the string as a file
        csvfile = io.StringIO(csv_text)
        # Use DictReader to read each row as a dictionary
        reader = csv.DictReader(csvfile)
        
        # Convert DictReader result to a list of dictionaries
        json_array = list(reader)
        
        # Return pretty-printed JSON
        return jsonify(json_array), 200

    except Exception as e:
        app.logger.error(f"CSV to JSON Conversion Error: {e}")
        return jsonify({"error": f"Failed to convert CSV to JSON: {str(e)}"}), 500


@app.route('/convert/json-to-sql', methods=['POST'])
def json_to_sql_route():
    """Converts JSON array payload to SQL INSERT statements."""
    try:
        data = request.get_json()
        json_text = data.get('data', '')
        
        if not json_text:
            return jsonify({"error": "No JSON data provided."}), 400

        # Attempt to parse the JSON input
        try:
            json_data = json.loads(json_text)
        except json.JSONDecodeError:
            return jsonify({"error": "Invalid JSON format provided."}), 400

        # Perform the conversion logic
        sql_statements = convert_json_to_sql(json_data)
        
        # Return the generated SQL as plain text
        return sql_statements, 200, {'Content-Type': 'text/plain'}

    except ValueError as ve:
        return jsonify({"error": str(ve)}), 400
    except Exception as e:
        app.logger.error(f"JSON to SQL Conversion Error: {e}")
        return jsonify({"error": f"Failed to convert JSON to SQL: {str(e)}"}), 500


@app.route('/bulk-convert', methods=['POST'])
def bulk_convert():
    """Handles bulk conversion of files within a ZIP archive. Fully in-memory."""
    try:
        # 1. Check for the file key (MUST be 'file' as per app.js)
        if 'file' not in request.files:
            return jsonify({"error": "No file part in the request. Ensure the field name is 'file'."}), 400
        
        uploaded_file = request.files['file']
        if uploaded_file.filename == '':
            return jsonify({"error": "No file selected."}), 400

        # 2. Read the uploaded ZIP into memory
        input_zip_bytes = io.BytesIO(uploaded_file.read())
        
        # 3. Create the output ZIP file in memory
        output_zip_bytes = io.BytesIO()
        
        with zipfile.ZipFile(input_zip_bytes, 'r') as input_zip:
            with zipfile.ZipFile(output_zip_bytes, 'w', zipfile.ZIP_DEFLATED) as output_zip:
                
                conversion_results = []
                
                for member in input_zip.infolist():
                    if member.is_dir():
                        continue
                        
                    filename = member.filename
                    
                    try:
                        # Read content as text
                        with input_zip.open(member, 'r') as file:
                            content_bytes = file.read()
                            # Assume UTF-8 encoding for config files
                            content = content_bytes.decode('utf-8')

                        converted_content = None
                        output_filename = filename

                        if filename.endswith(('.json', '.JSON')):
                            # JSON to YAML conversion
                            data = json.loads(content)
                            converted_content = yaml.dump(data, sort_keys=False)
                            output_filename = filename.rsplit('.', 1)[0] + '.yaml'
                            conversion_results.append(f"Converted: {filename} -> {output_filename}")

                        elif filename.endswith(('.yaml', '.yml', '.YAML', '.YML')):
                            # YAML to JSON conversion
                            data = yaml.safe_load(content)
                            converted_content = json.dumps(data, indent=2)
                            output_filename = filename.rsplit('.', 1)[0] + '.json'
                            conversion_results.append(f"Converted: {filename} -> {output_filename}")
                            
                        # If conversion happened, write to the output ZIP
                        if converted_content is not None:
                            output_zip.writestr(output_filename, converted_content)
                        else:
                            # If not converted (e.g., it was an image or unsupported file), copy it over
                            output_zip.writestr(filename, content_bytes)


                    except Exception as conversion_error:
                        error_message = f"ERROR converting {filename}: {str(conversion_error)}"
                        # Log error internally
                        app.logger.error(error_message)
                        # Add an error file to the ZIP for the user
                        output_zip.writestr(f"ERROR_{filename}.txt", error_message)
                        conversion_results.append(f"Failed: {filename}")


        # 4. Prepare the in-memory ZIP for sending
        output_zip_bytes.seek(0)
        
        # 5. Send the file back to the client
        return send_file(
            output_zip_bytes,
            mimetype='application/zip',
            as_attachment=True,
            download_name='dataxlator_converted_files.zip'
        )

    except Exception as e:
        # Catch any high-level errors (e.g., zip corruption, memory issue)
        app.logger.error(f"Critical Bulk Conversion Failure: {e}")
        return jsonify({"error": f"Critical server error during bulk conversion: {str(e)}"}), 500

if __name__ == '__main__':
    # When running locally (for development)
    app.run(debug=True, port=5000)