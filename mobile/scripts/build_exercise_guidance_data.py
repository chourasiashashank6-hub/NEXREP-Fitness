#!/usr/bin/env python3
"""Build ExerciseGuidanceData.ts from guidance records in the user spec."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_TS = ROOT / "src/constants/ExerciseGuidanceData.ts"
TRANSCRIPT = Path(
    "/Users/shashankchourasia/.cursor/projects/Users-shashankchourasia-Desktop-Archive/"
    "agent-transcripts/5c462d33-1728-4742-afee-b76ed7ede9f2/5c462d33-1728-4742-afee-b76ed7ede9f2.jsonl"
)
INPUT_TXT = Path(__file__).resolve().parent / "guidance_records_input.txt"


def load_source_text() -> str:
    if INPUT_TXT.is_file():
        return INPUT_TXT.read_text(encoding="utf-8")
    if not TRANSCRIPT.is_file():
        raise SystemExit("No input: provide guidance_records_input.txt or transcript")
    for line in TRANSCRIPT.read_text(encoding="utf-8").splitlines():
        if '"Exercise Guidance Card"' not in line and "ExerciseGuidanceData.ts" not in line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        for part in obj.get("message", {}).get("content", []):
            if part.get("type") == "text":
                text = part.get("text", "")
                if "GUIDANCE RECORDS" in text and "PART 2" in text:
                    return text
    raise SystemExit("Could not find guidance records in transcript")


def js_muscles_to_json(muscles_js: str) -> str:
    s = muscles_js.strip()
    s = re.sub(r"\{name:", '{"name":', s)
    s = re.sub(r",role:", ',"role":', s)
    return s


def parse_records(text: str) -> list[dict]:
    start = text.find("GUIDANCE RECORDS")
    end = text.find("PART 2 — NEW COMPONENT")
    if start < 0 or end < 0:
        raise SystemExit("Markers not found in source text")
    block = text[start:end]
    pattern = re.compile(
        r'\{ exerciseName: "(.*?)", posture: "(.*?)", muscles: (\[.*?\]), '
        r'formCues: "(.*?)", cautions: "(.*?)", proTip: "(.*?)" \},',
        re.DOTALL,
    )
    records = []
    for m in pattern.finditer(block):
        name, posture, muscles_js, form_cues, cautions, pro_tip = m.groups()
        muscles = json.loads(js_muscles_to_json(muscles_js))
        records.append(
            {
                "exerciseName": name,
                "posture": posture,
                "muscles": muscles,
                "formCues": form_cues,
                "cautions": cautions,
                "proTip": pro_tip,
            }
        )
    return records


def ts_string(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def emit_ts(records: list[dict]) -> str:
    lines = [
        'export type MuscleTag = {',
        '  name: string;',
        '  role: "primary" | "secondary";',
        "};",
        "",
        "export type ExerciseGuidance = {",
        "  exerciseName: string;",
        "  posture: string;",
        "  muscles: MuscleTag[];",
        "  formCues: string;",
        "  cautions: string;",
        "  proTip: string;",
        "};",
        "",
        "export const EXERCISE_GUIDANCE: ExerciseGuidance[] = [",
    ]
    for r in records:
        muscle_parts = []
        for m in r["muscles"]:
            muscle_parts.append(
                f'{{ name: {ts_string(m["name"])}, role: {ts_string(m["role"])} }}'
            )
        muscles_str = ", ".join(muscle_parts)
        lines.append("  {")
        lines.append(f'    exerciseName: {ts_string(r["exerciseName"])},')
        lines.append(f"    posture: {ts_string(r['posture'])},")
        lines.append(f"    muscles: [{muscles_str}],")
        lines.append(f"    formCues: {ts_string(r['formCues'])},")
        lines.append(f"    cautions: {ts_string(r['cautions'])},")
        lines.append(f"    proTip: {ts_string(r['proTip'])},")
        lines.append("  },")
    lines.append("];")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    text = load_source_text()
    records = parse_records(text)
    if not records:
        raise SystemExit("No records parsed")
    records.sort(key=lambda r: r["exerciseName"].lower())
    OUT_TS.write_text(emit_ts(records), encoding="utf-8")
    print(f"Wrote {len(records)} records to {OUT_TS}")


if __name__ == "__main__":
    main()
