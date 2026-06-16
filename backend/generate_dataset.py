# generate_dataset.py — manual version, no LLM needed
# Just validates and previews your hand-written CSV

import csv
import os

CSV_PATH = "../data/eval/questions.csv"

def validate_dataset(csv_path: str):
    with open(csv_path, encoding="utf-8") as f:
        dataset = list(csv.DictReader(f))

    answerable   = [r for r in dataset if r["answerable"].strip().lower() == "true"]
    unanswerable = [r for r in dataset if r["answerable"].strip().lower() == "false"]

    print(f"Total questions  : {len(dataset)}")
    print(f"Answerable       : {len(answerable)}")
    print(f"Unanswerable     : {len(unanswerable)}")
    print(f"Ratio            : {len(answerable)/(len(dataset) or 1):.0%} answerable\n")

    # check for bad rows
    issues = []
    for i, row in enumerate(dataset):
        if not row.get("question","").strip():
            issues.append(f"Row {i+2}: empty question")
        if row["answerable"].strip().lower() == "true" and not row.get("answer","").strip():
            issues.append(f"Row {i+2}: answerable but no answer — '{row['question'][:50]}'")

    if issues:
        print("── Issues found ──────────────────────────")
        for issue in issues:
            print(f"  ✗ {issue}")
    else:
        print("── Dataset looks clean ✓ ─────────────────")

    print("\n── Sample questions ──────────────────────")
    for row in dataset[:5]:
        print(f"  Q: {row['question'][:70]}")
        print(f"  A: {row['answer'][:70]}")
        print(f"  Answerable: {row['answerable']} | Page: {row.get('source_page','?')}\n")

if __name__ == "__main__":
    if not os.path.exists(CSV_PATH):
        print(f"CSV not found at {CSV_PATH}")
        print("Create it manually with columns: question, answer, answerable, source_page")
    else:
        validate_dataset(CSV_PATH)