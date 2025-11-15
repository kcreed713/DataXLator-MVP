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
from collections import OrderedDict
from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
import re

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

#DXL-1 | David Morales | starts

@app.route('/')
def home():
    return send_from_directory('.', 'index.html')

#DXL-1 | David Morales | ends


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

#DXL-1 | David Morales | starts
def mysql_to_graphql(sql_str: str) -> str:
    """
    Best-effort MySQL → GraphQL converter.
    Supports:
      - CREATE TABLE ... → GraphQL type
      - Simple SELECT ... FROM ... [WHERE ...] → query
      - INSERT / UPDATE / DELETE → mutation stubs

    It NEVER raises on bad SQL; instead it returns commented stubs.
    """
    raw = (sql_str or "").strip()
    if not raw:
        return "# Empty SQL input\n"

    # Allow multiple statements separated by ';'
    statements = [s.strip() for s in raw.split(';') if s.strip()]
    parts = []

    for stmt in statements:
        up = stmt.lstrip().upper()

        if up.startswith("CREATE TABLE"):
            parts.append(_mysql_create_table_to_graphql(stmt))
        elif up.startswith("SELECT"):
            parts.append(_mysql_select_to_graphql(stmt))
        elif up.startswith("INSERT"):
            parts.append(_mysql_insert_to_graphql(stmt))
        elif up.startswith("UPDATE"):
            parts.append(_mysql_update_to_graphql(stmt))
        elif up.startswith("DELETE"):
            parts.append(_mysql_delete_to_graphql(stmt))
        else:
            parts.append(
                "# Unsupported SQL statement; adjust manually.\n"
                "# " + stmt.replace("\n", "\n# ")
            )

    return "\n\n".join(parts)


def _dxl_to_pascal(name: str) -> str:
    parts = re.split(r"[_\s]+", name)
    return "".join(p.capitalize() for p in parts if p)


def _dxl_to_camel(name: str) -> str:
    parts = re.split(r"[_\s]+", name)
    if not parts:
        return name
    return parts[0].lower() + "".join(p.capitalize() for p in parts[1:])


def _dxl_singular(name: str) -> str:
    if name.endswith("ies"):
        return name[:-3] + "y"
    if name.endswith("ses"):
        return name[:-2]
    if name.endswith("s") and not name.endswith("ss"):
        return name[:-1]
    return name


def _mysql_create_table_to_graphql(stmt: str) -> str:
    """
    CREATE TABLE → GraphQL type
    Handles:
      CREATE TABLE [IF NOT EXISTS] `schema`.`table` ( ... ) ENGINE=...
    """
    sql = stmt.strip()
    pattern = r"""
        CREATE\s+TABLE
        (?:\s+IF\s+NOT\s+EXISTS)?
        \s+(?P<name>`?[\w]+`?(?:\.`?[\w]+`?)?)
        \s*\(
            (?P<body>.*?)
        \)
        (?:\s+ENGINE\b.*)?
        \s*$
    """
    m = re.search(pattern, sql, flags=re.IGNORECASE | re.DOTALL | re.VERBOSE)
    if not m:
        return "# Could not parse CREATE TABLE.\n# " + sql.replace("\n", "\n# ")

    full_name = m.group("name")
    body = m.group("body")

    # schema.table → take last part
    if "." in full_name:
        table_name_raw = full_name.split(".")[-1]
    else:
        table_name_raw = full_name

    table_name_raw = table_name_raw.strip("`\"")
    singular = _dxl_singular(table_name_raw)
    gql_type_name = _dxl_to_pascal(singular)

    lines = [ln.strip().rstrip(",") for ln in body.splitlines() if ln.strip()]
    fields = []

    for line in lines:
        upper = line.upper()
        if upper.startswith((
            "PRIMARY KEY", "FOREIGN KEY", "UNIQUE", "KEY",
            "CONSTRAINT", "INDEX", "FULLTEXT", "SPATIAL"
        )):
            continue

        tokens = line.split()
        if not tokens:
            continue

        col_token = tokens[0]
        col_name_raw = col_token.strip("`\"")
        sql_type = tokens[1] if len(tokens) > 1 else "TEXT"
        rest = " ".join(tokens[2:]).upper()

        gql_type = _mysql_sql_type_to_graphql(sql_type)

        # id / <table>_id → ID
        if col_name_raw.lower() in ("id", f"{singular.lower()}_id"):
            gql_type = "ID"

        if "NOT NULL" in rest or "PRIMARY KEY" in rest:
            gql_type += "!"

        field_name = _dxl_to_camel(col_name_raw)
        fields.append(f"  {field_name}: {gql_type}")

    if not fields:
        fields.append("  # TODO: no columns parsed")

    return f"type {gql_type_name} {{\n" + "\n".join(fields) + "\n}"


def _mysql_select_to_graphql(stmt: str) -> str:
    """
    Simple SELECT → GraphQL query.
    Keeps WHERE as a comment if present.
    """
    sql = stmt.strip().rstrip(";")
    pattern = r"""
        SELECT\s+(?P<select>.+?)\s+
        FROM\s+(?P<table>[\w`]+)
        (?:\s+WHERE\s+(?P<where>.+))?
        $
    """
    m = re.search(pattern, sql, flags=re.IGNORECASE | re.DOTALL | re.VERBOSE)
    if not m:
        return (
            "# Could not parse SELECT.\n# " + sql.replace("\n", "\n# ") +
            "\n\nquery {\n  # TODO: define field & selection set\n}\n"
        )

    select_raw = m.group("select").strip()
    table_raw = m.group("table").strip("`")
    where_raw = m.group("where").strip() if m.group("where") else None

    table_field = _dxl_to_camel(table_raw)

    fields = []
    for part in select_raw.split(","):
        p = part.strip()
        if not p:
            continue
        alias_match = re.search(r"\bAS\b\s+(\w+)$", p, flags=re.IGNORECASE)
        if alias_match:
            fname = alias_match.group(1)
        else:
            last = p.split()[-1]
            if "." in last:
                last = last.split(".")[-1]
            fname = last.strip("`\"")
        fields.append(f"    {_dxl_to_camel(fname)}")

    if not fields:
        fields.append("    # TODO: add fields")

    where_comment = f"    # WHERE: {where_raw}\n" if where_raw else ""
    selection_block = "\n".join(fields)

    return (
        "# From SELECT:\n"
        "# " + sql.replace("\n", "\n# ") + "\n\n"
        "query {\n"
        f"  {table_field} {{\n"
        f"{where_comment}"
        f"{selection_block}\n"
        "  }\n"
        "}"
    )


def _mysql_insert_to_graphql(stmt: str) -> str:
    sql = stmt.strip()
    pattern = r"""
        INSERT\s+INTO\s+`?(?P<table>\w+)`?
        \s*(?:\((?P<cols>[^)]+)\))?
        \s*VALUES\s*(?P<values>.+)
    """
    m = re.search(pattern, sql, flags=re.IGNORECASE | re.DOTALL | re.VERBOSE)
    if not m:
        return "# Could not parse INSERT.\n# " + sql.replace("\n", "\n# ")

    table = m.group("table")
    cols_raw = m.group("cols")
    values_raw = m.group("values")

    cols = [c.strip("` ") for c in cols_raw.split(",")] if cols_raw else []

    groups = re.findall(r"\(([^)]+)\)", values_raw)
    objects = []

    for g in groups:
        vals = [v.strip() for v in g.split(",")]
        if cols:
            pairs = list(zip(cols, vals))
        else:
            pairs = [(f"col{i+1}", v) for i, v in enumerate(vals)]
        lines = [f"      {_dxl_to_camel(c)}: {v}" for c, v in pairs]
        objects.append("    {\n" + "\n".join(lines) + "\n    }")

    objects_block = ",\n".join(objects) if objects else "    # TODO: add objects"

    return (
        "# From INSERT:\n"
        "# " + sql.replace("\n", "\n# ") + "\n\n"
        "mutation {\n"
        f"  insert_{_dxl_to_camel(table)}(\n"
        "    objects: [\n"
        f"{objects_block}\n"
        "    ]\n"
        "  ) {\n"
        "    # TODO: select fields to return\n"
        "  }\n"
        "}"
    )


def _mysql_update_to_graphql(stmt: str) -> str:
    sql = stmt.strip()
    pattern = r"""
        UPDATE\s+`?(?P<table>\w+)`?
        \s+SET\s+(?P<set>.+?)
        (?:\s+WHERE\s+(?P<where>.+))?
        $
    """
    m = re.search(pattern, sql, flags=re.IGNORECASE | re.DOTALL | re.VERBOSE)
    if not m:
        return "# Could not parse UPDATE.\n# " + sql.replace("\n", "\n# ")

    table = m.group("table")
    set_raw = m.group("set")
    where_raw = m.group("where")

    assignments = []
    for part in set_raw.split(","):
        p = part.strip()
        if "=" in p:
            col, val = p.split("=", 1)
            assignments.append((_dxl_to_camel(col.strip("` ")), val.strip()))
        else:
            assignments.append((_dxl_to_camel(p), "/* TODO: value */"))

    set_lines = [f"      {c}: {v}" for c, v in assignments] or ["      # TODO: _set fields"]
    where_comment = f"      # WHERE: {where_raw}\n" if where_raw else "      # WHERE: TODO\n"

    return (
        "# From UPDATE:\n"
        "# " + sql.replace("\n", "\n# ") + "\n\n"
        "mutation {\n"
        f"  update_{_dxl_to_camel(table)}(\n"
        "    where: {\n"
        f"{where_comment}"
        "    },\n"
        "    _set: {\n"
        f"{'\n'.join(set_lines)}\n"
        "    }\n"
        "  ) {\n"
        "    # TODO: select fields to return\n"
        "  }\n"
        "}"
    )


def _mysql_delete_to_graphql(stmt: str) -> str:
    sql = stmt.strip()
    pattern = r"""
        DELETE\s+FROM\s+`?(?P<table>\w+)`?
        (?:\s+WHERE\s+(?P<where>.+))?
        $
    """
    m = re.search(pattern, sql, flags=re.IGNORECASE | re.DOTALL | re.VERBOSE)
    if not m:
        return "# Could not parse DELETE.\n# " + sql.replace("\n", "\n# ")

    table = m.group("table")
    where_raw = m.group("where")
    where_comment = f"      # WHERE: {where_raw}\n" if where_raw else "      # WHERE: TODO\n"

    return (
        "# From DELETE:\n"
        "# " + sql.replace("\n", "\n# ") + "\n\n"
        "mutation {\n"
        f"  delete_{_dxl_to_camel(table)}(\n"
        "    where: {\n"
        f"{where_comment}"
        "    }\n"
        "  ) {\n"
        "    # TODO: select fields to return\n"
        "  }\n"
        "}"
    )


def _mysql_sql_type_to_graphql(sql_type: str) -> str:
    t = sql_type.upper()
    if t.startswith(("INT", "BIGINT", "SMALLINT", "TINYINT", "MEDIUMINT")):
        return "Int"
    if t.startswith(("DECIMAL", "NUMERIC", "FLOAT", "DOUBLE", "REAL")):
        return "Float"
    if "CHAR" in t or "TEXT" in t or "CLOB" in t:
        return "String"
    if "BLOB" in t or "BINARY" in t or "VARBINARY" in t:
        return "String"
    if "BOOL" in t:
        return "Boolean"
    if "DATE" in t or "TIME" in t or "TIMESTAMP" in t or "YEAR" in t:
        return "String"
    return "String"



#DXL-1 | David Morales | ends
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

# #DXL-1 | David Morales | MySQL SQL → GraphQL Processing | starts
@app.route('/convert', methods=['POST'])
def convert_single():
    """
    Single-shot conversion API used by the Free converter tab.
    Extend this as you add more format pairs.
    """
    payload = request.get_json(silent=True) or {}
    input_format = (payload.get('inputFormat') or '').lower()
    output_format = (payload.get('outputFormat') or '').lower()
    text = payload.get('text') or ''

    try:
        if input_format == 'sql' and output_format == 'graphql':
            result = mysql_to_graphql(text)
        elif input_format == 'json' and output_format == 'yaml':
            result = json_to_yaml(text)
        elif input_format == 'yaml' and output_format == 'json':
            result = yaml_to_json(text)
        elif input_format == 'csv' and output_format == 'json':
            result = csv_to_json(text)
        else:
            return jsonify({
                "error": f"Unsupported conversion: {input_format} → {output_format}"
            }), 400

        return jsonify({"result": result}), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 400

# #DXL-1 | David Morales | MySQL SQL → GraphQL Processing | ends

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

if __name__ == '__main__':
    app.run(debug=True, port=5000)