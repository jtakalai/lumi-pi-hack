# Task: implement `parse_fields`

Implement a Python module **`parse.py`** in this directory defining exactly one
public function:

```python
def parse_fields(line: str) -> list[str]: ...
```

It parses ONE line of a simplified CSV dialect into a list of fields.

## Rules

1. Fields are separated by commas (`,`).
2. A field whose **first character is `"`** is a *quoted* field:
   - It ends at the first `"` that is **not** immediately followed by another `"`.
   - Inside a quoted field, two consecutive quotes `""` represent ONE literal
     `"` in the output.
   - Commas inside a quoted field are data, not separators.
   - After the closing quote the field is complete; any characters between the
     closing quote and the next separator (or end of line) are ignored.
3. A field that does not start with `"` is *unquoted*: its characters are kept
   verbatim (quotes inside it are literal data), and leading/trailing
   whitespace is stripped.
4. An empty or whitespace-only line yields `[]`.
5. An empty field (e.g. from `a,,b` or a trailing comma in `a,`) yields the
   empty string `""`.

## Examples

| input | output |
|---|---|
| `a,b,c` | `["a", "b", "c"]` |
| `"a,b"` | `["a,b"]` |
| `""` | `[""]` |
| `"say ""hi"""` | `['say "hi"']` |
| `a,` | `["a", ""]` |
| `   ` | `[]` |

## Verification

`test_parse.py` (in this directory) is the grader. Run:

```
python3 test_parse.py
```

It prints one `FAIL <case>: ...` line per failing case and exits 1, or prints
`PASS: all 12 test cases` and exits 0. **Do not modify `test_parse.py` or
this SPEC.md.** Your job: make `parse.py` until the test prints PASS.
