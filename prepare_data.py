import os
import json
import shutil
import pandas as pd

source_csv = "/Users/abhinavkumar/Downloads/Health360_synthetic_healthcare_dataset.csv"
output_dir = "/Users/abhinavkumar/.gemini/antigravity-ide/scratch/health360_dashboard"
os.makedirs(output_dir, exist_ok=True)

# Copy source CSV
dest_csv = os.path.join(output_dir, "dataset.csv")
shutil.copyfile(source_csv, dest_csv)
print(f"Copied CSV to {dest_csv}")

# Load raw dataset without treating literal string 'None' as NaN
df = pd.read_csv(source_csv, keep_default_na=False)

# Replace empty strings in numeric columns with None for true JSON null representation
import numpy as np
for num_col in ['age', 'height_cm', 'weight_kg', 'bmi', 'systolic_bp', 'diastolic_bp', 'cholesterol_mg_dl', 'glucose_mg_dl']:
    if num_col in df.columns:
        df[num_col] = pd.to_numeric(df[num_col], errors='coerce')
        df[num_col] = df[num_col].replace({np.nan: None})

# For categorical columns, ensure empty strings are labeled 'Not Reported'
for cat_col in ['sex', 'region', 'smoking_status', 'alcohol_consumption', 'exercise_level', 'chest_pain', 'fatigue', 'dizziness']:
    if cat_col in df.columns:
        df[cat_col] = df[cat_col].replace({'': 'Not Reported'})

records = df.to_dict(orient="records")

# Write to data.js
data_js_path = os.path.join(output_dir, "data.js")
with open(data_js_path, "w", encoding="utf-8") as f:
    f.write("// Auto-generated Health360 Dataset (Empirical Raw Records with True Nulls)\n")
    f.write("window.HEALTH360_RAW_DATA = ")
    json.dump(records, f, indent=None)
    f.write(";\n")

print(f"Successfully exported {len(records)} authentic records to {data_js_path}")

