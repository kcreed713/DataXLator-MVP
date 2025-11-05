# ╔═ ✨ ROUTE: /convert-pro (Fallback / Mirror) ═══════════════════════════════════╗
# Story: DXL-1 — Temporarily mirror Free route for Oracle SQL → GraphQL.
# Author: David Morales
# Company: DataXLator
# Date: 2025-11-05
# ╚═══════════════════════════════════════════════════════════════════════════════╝
import io
import json
import zipfile
import yaml
import csv
import os
import base64 # Required for decoding Base64 credentials
import re
from collections import OrderedDict
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

# --- FIREBASE FIRESTORE SETUP ---
# Requires: pip install firebase-admin
from firebase_admin import credentials, initialize_app, firestore

db = None # Firestore client instance

try:
    # 1. Load Base64 encoded JSON string from environment variable
    base64_json_string = os.environ.get('FIREBASE_ADMIN_CREDENTIALS')
    
    if base64_json_string:
        # 2. Decode the Base64 string back into JSON bytes
        service_account_json_bytes = base64.b64decode(base64_json_string)
        
        # 3. Load JSON content into a dict (in memory) and initialize the SDK
        cred_dict = json.loads(service_account_json_bytes.decode('utf-8'))
        cred = credentials.Certificate(cred_dict)
        
        initialize_app(cred)
        db = firestore.client()
        print("Firestore client initialized successfully.")
    else:
        print("WARNING: FIREBASE_ADMIN_CREDENTIALS environment variable not set. Database will not function.")
        
except Exception as e:
    print(f"FATAL ERROR initializing Firebase Admin SDK: {e}.")


app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}) 

# --- CONFIGURATION & SECRETS ---
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024 

# Load the webhook secret securely from environment variables
WEBHOOK_SECRET = os.environ.get('WEBHOOK_SECRET', 'NO_SECRET_SET')
print(f"Webhook Secret Status: {'Set' if WEBHOOK_SECRET != 'NO_SECRET_SET' else 'MISSING'}")


# --- FIRESTORE HELPER FUNCTIONS ---

def get_pro_status_ref(user_id):
    """
    Helper to get the correct Firestore document reference for the user's Pro status.
    This path MUST match the listener path in the frontend app.js: 
    users/{userId}/subscriptions/dataxlator
    """
    if db is None:
        return None
        
    return db.collection('users').document(user_id).collection('subscriptions').document('dataxlator')

def get_user_status_db(user_id):
    """Fetches user status from Firestore. Returns (data, error)."""
    
    user_ref = get_pro_status_ref(user_id)
    if user_ref is None:
        return None, "Database not initialized."
    
    try:
        doc = user_ref.get()
        if doc.exists:
            # Returns user data if found
            return doc.to_dict(), None
        # Returns empty dict if not found (defaults to non-Pro)
        return {}, None 
    except Exception as e:
        return None, f"Firestore read failed: {e}"

def update_user_pro_status(user_id, is_pro_status):
    """Updates user's isPro status in Firestore. Returns (success, error)."""
    
    user_ref = get_pro_status_ref(user_id)
    if user_ref is None:
        return False, "Database not initialized."

    try:
        # CRITICAL FIX: The update now targets the /subscriptions/dataxlator document.
        # This document needs to be created first (handled by app.js ensureUserDocumentExists)
        # but merge=True ensures it updates or creates the document safely.
        user_ref.set({'isPro': is_pro_status, 'updatedAt': firestore.SERVER_TIMESTAMP}, merge=True)
        return True, None
    except Exception as e:
        return False, f"Firestore update failed: {e}"


# --- Conversion Helper Functions (Kept from original) ---

class NoAliasSafeDumper(yaml.SafeDumper):
    """Custom YAML Dumper to prevent aliases and preserve dictionary key order."""
    pass

def dict_representer(dumper, data):
    return dumper.represent_mapping('tag:yaml.org,2002:map', data.items())

NoAliasSafeDumper.add_representer(dict, dict_representer)
NoAliasSafeDumper.add_representer(OrderedDict, dict_representer)

def json_to_yaml(data_str):
    data = json.loads(data_str, object_pairs_hook=OrderedDict)
    return yaml.dump(data, Dumper=NoAliasSafeDumper, default_flow_style=False)

def yaml_to_json(data_str):
    data = yaml.safe_load(data_str)
    return json.dumps(data, indent=2)

def json_to_sql_insert(json_data_str, table_name="your_table"):
    data = json.loads(json_data_str, object_pairs_hook=OrderedDict)
    if isinstance(data, dict): data = [data]
    if not isinstance(data, list) or not data or not data[0].keys():
        raise ValueError("JSON data must be a non-empty object or array of objects.")
        
    columns = data[0].keys()
    columns_str = ", ".join([f"`{c}`" for c in columns])
    sql_statements = []
    
    for row in data:
        values = []
        for col in columns:
            value = row.get(col)
            if isinstance(value, str): values.append(f"'{value.replace('\'', '\'\'')}'") 
            elif isinstance(value, (dict, list)):
                json_value = json.dumps(value)
                values.append(f"'{json_value.replace('\'', '\'\'')}'")
            elif value is None: values.append('NULL')
            else: values.append(str(value))
            
        values_str = ", ".join(values)
        sql = f"INSERT INTO `{table_name}` ({columns_str}) VALUES ({values_str});"
        sql_statements.append(sql)
        
    return "\n".join(sql_statements)

def csv_to_json(data_str):
    f = io.StringIO(data_str)
    reader = csv.DictReader(f)
    json_data = list(reader)
    return json.dumps(json_data, indent=2)

# ADDED BY DAVID MORALES | DATAAPP-1 | starts
# --- Oracle SQL -> GraphQL helpers (Pro) ---
ORACLE_TO_GQL = {
    'VARCHAR2':'String','NVARCHAR2':'String','CHAR':'String','CLOB':'String',
    'NUMBER':'Float','INTEGER':'Int','INT':'Int','FLOAT':'Float',
    'BINARY_FLOAT':'Float','BINARY_DOUBLE':'Float',
    'DATE':'Date','TIMESTAMP':'DateTime',
    'TIMESTAMP WITH TIME ZONE':'DateTime',
    'TIMESTAMP WITH LOCAL TIME ZONE':'DateTime'
}
CREATE_TABLE_RE = re.compile(
    r'CREATE\s+TABLE\s+(?P<name>"?[\w$#]+"?)\s*\((?P<body>.*?)\)\s*;',
    re.IGNORECASE | re.DOTALL
)
COLUMN_RE = re.compile(
    r'^\s*(?P<name>"?[\w$#]+"?)\s+(?P<type>[\w\s]+?)(?:\s*\(\s*(?P<len>[^)]+)\s*\))?',
    re.IGNORECASE
)
NOT_NULL_RE = re.compile(r'\bNOT\s+NULL\b', re.IGNORECASE)

def _clean_ident(s):
    return s.strip().strip('"')

def _oracle_type_to_gql(t, spec):
    t = ' '.join(t.upper().split())
    if t.startswith('NUMBER') and spec:
        parts = [p.strip() for p in spec.split(',')]
        if len(parts) == 2 and parts[1] == '0':
            return 'Int'
    return ORACLE_TO_GQL.get(t, 'String')

def oracle_sql_to_graphql(sql_text: str) -> str:
    types = []
    for m in CREATE_TABLE_RE.finditer(sql_text):
        name = _clean_ident(m.group('name'))
        body = m.group('body')
        cols = []
        for ln in [ln for ln in body.splitlines() if ln.strip()]:
            cm = COLUMN_RE.match(ln)
            if not cm:
                continue
            cname = _clean_ident(cm.group('name'))
            ctype = cm.group('type')
            clen  = cm.group('len')
            notnull = bool(NOT_NULL_RE.search(ln))
            gqlt = _oracle_type_to_gql(ctype, clen)
            cols.append((cname, gqlt, notnull))
        lines = [f"type {name} "+"{"] + [f"  {c}: {t}{'!' if nn else ''}" for c,t,nn in cols] + ["}"]
        types.append("\n".join(lines))
    header = "scalar Date\nscalar DateTime\n\n"
    return header + "\n\n".join(types) if types else ""

# ADDED BY DAVID MORALES | DATAAPP-1 | ends
# --- API ENDPOINTS ---

@app.route('/user/<user_id>', methods=['GET'])
def get_user_status(user_id):
    """Endpoint for clients to check a user's Pro status."""
    user_data, error = get_user_status_db(user_id)
    
    if user_data is not None and error is None:
        is_pro = user_data.get("isPro", False) # Default to False if field is missing
        return jsonify({"user_id": user_id, "isPro": is_pro}), 200
    
    # Handle DB init error or read failure
    status_code = 500 if "Database not initialized" in (error or "") else 404
    return jsonify({"user_id": user_id, "isPro": False, "error": error or "User not found"}), status_code

@app.route('/webhook/payment-success', methods=['POST'])
def handle_payment_success():
    """Secure endpoint for the payment processor to upgrade a user to Pro."""
    # SECURITY: Verify the webhook secret provided in the request header
    if request.headers.get('X-Webhook-Secret') != WEBHOOK_SECRET:
        return jsonify({"error": "Unauthorized: Invalid webhook secret"}), 403

    try:
        data = request.get_json()
        user_id = data.get('user_id') 

        if not user_id:
            return jsonify({"error": "Missing user_id in payload"}), 400

        # Update the user's status in Firestore
        success, db_error = update_user_pro_status(user_id, True)

        if success:
            return jsonify({"status": "acknowledged", "user_id": user_id, "isPro": True}), 200
        else:
            return jsonify({"error": f"Failed to update user status in DB: {db_error}"}), 500

    except Exception as e:
        print(f"Error processing webhook: {e}")
        return jsonify({"error": "Internal server error during webhook processing"}), 500


@app.route('/bulk-convert', methods=['POST'])
def bulk_convert():
    """The main monetized feature: handles bulk conversion after a Pro status check."""
    user_id = request.args.get('user_id') 
    
    # 1. CHECK PRO STATUS
    # The DB check now automatically uses the correct path: users/{userId}/subscriptions/dataxlator
    user_data, error = get_user_status_db(user_id)
    is_pro = user_data.get('isPro', False) if user_data else False

    # Monetization Gate: Block if user is not verified or not Pro
    if not user_id or not is_pro:
        if error and "Database" in error:
             return jsonify({"error": "Internal Database error. Try again later."}), 500
        return jsonify({"error": "Access Denied. This bulk conversion feature is reserved for Pro users."}), 403

    # 2. FILE VALIDATION (Original logic)
    if 'zip_file' not in request.files:
        return jsonify({"error": "No ZIP file part in the request."}), 400

    uploaded_file = request.files['zip_file']

    if not uploaded_file.filename.lower().endswith('.zip'):
        return jsonify({"error": "File must be a ZIP archive."}), 400

    # 3. PROCESSING LOGIC (Original logic)
    try:
        input_zip_buffer = io.BytesIO(uploaded_file.read())
        output_zip_buffer = io.BytesIO()
        file_count = 0
        
        with zipfile.ZipFile(input_zip_buffer, 'r') as input_zip:
            with zipfile.ZipFile(output_zip_buffer, 'w', zipfile.ZIP_DEFLATED) as output_zip:
                
                for filename in input_zip.namelist():
                    if filename.endswith('/'): continue
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
                            
                            # JSON Processing
                            if lower_filename.endswith(('.json')):
                                converted_content = json_to_yaml(content)
                                new_filename = filename.replace('.json', '.yaml')
                                convert_type = 'JSON_TO_YAML'
                                try:
                                    converted_content_sql = json_to_sql_insert(content)
                                    new_filename_sql = filename.replace('.json', '.sql')
                                except Exception as sql_e:
                                    print(f"Skipped JSON to SQL conversion for {filename}: {str(sql_e)}")
                                    pass

                            # YAML Processing
                            elif lower_filename.endswith(('.yaml', '.yml')):
                                converted_content = yaml_to_json(content)
                                new_filename = filename.replace('.yaml', '.json').replace('.yml', '.json')
                                convert_type = 'YAML_TO_JSON'

                            # CSV Processing
                            elif lower_filename.endswith(('.csv')):
                                json_content = csv_to_json(content)
                                converted_content = json_content
                                new_filename = filename.replace('.csv', '.json')
                                convert_type = 'CSV_TO_JSON'
                                try:
                                    converted_content_sql = json_to_sql_insert(json_content)
                                    new_filename_sql = filename.replace('.csv', '.sql')
                                except Exception as sql_e:
                                    print(f"Skipped CSV to SQL conversion for {filename}: {str(sql_e)}")
                                    pass
                            
                    except Exception as e:
                        error_message = f"ERROR converting {filename} (Type: {convert_type or 'Unknown'}): {str(e)}"
                        print(error_message)
                        new_filename = f"{filename}_ERROR.txt"
                        converted_content = error_message
                        
                    if converted_content and new_filename:
                        output_zip.writestr(new_filename, converted_content.encode('utf-8'))
                    if converted_content_sql and new_filename_sql:
                            output_zip.writestr(new_filename_sql, converted_content_sql.encode('utf-8'))


                if file_count == 0:
                    return jsonify({"error": "ZIP file contained no recognizable files (.json, .yaml, .yml, .csv)"}), 400

            output_zip_buffer.seek(0)
            
            # 4. SEND RESPONSE
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

# Story: DXL-1 — Add single-file conversion for Oracle SQL → GraphQL (Free) | David Morales | starts
@app.route("/convert-single", methods=["POST"])
def convert_single():
    """Handle single-file conversions for the Free tab."""
    data = request.get_json(force=True) or {}
    input_fmt  = (data.get("inputFormat") or "").lower()
    output_fmt = (data.get("outputFormat") or "").lower()
    content    = data.get("content") or ""

    # --- 🔹 Oracle SQL → GraphQL (Free) ---
    if (input_fmt, output_fmt) == ("sql", "graphql"):
        try:
            gql = oracle_sql_to_graphql(content)
            if not gql.strip():
                return jsonify({"error": "Could not parse Oracle SQL. Make sure each CREATE TABLE ends with ';'."}), 400
            return jsonify({"converted": gql})
        except Exception as e:
            return jsonify({"error": f"Conversion failed: {e}"}), 500

    # You can add other pairs here later (json↔yaml, csv↔json, etc.)
    return jsonify({"error": "Unsupported conversion pair."}), 400
# Story: DXL-1 — Add single-file conversion for Oracle SQL → GraphQL (Free) | David Morales | ends
if __name__ == '__main__':
    app.run(debug=True, port=5000)