"""Grader for smoke-task. Run: python3 test_parse.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

CASES = [
    ("simple", "a,b,c", ["a", "b", "c"]),
    ("spaces", "a, b , c", ["a", "b", "c"]),
    ("empty_quoted", '""', [""]),
    ("embedded_comma", '"a,b"', ["a,b"]),
    ("escaped_quotes", '"say ""hi""",x', ['say "hi"', "x"]),
    ("two_empty", ",", ["", ""]),
    ("trailing_comma", "a,", ["a", ""]),
    ("whitespace_only", "   ", []),
    ("single_escaped_quote", '""""', ['"']),
    ("mixed", '"x",y,"z,w"', ["x", "y", "z,w"]),
    ("unquoted_literal_quotes", 'a""b', ['a""b']),
    ("quotes_mid_unquoted", 'pre "quoted",b', ['pre "quoted"', "b"]),
]


def main() -> int:
    try:
        from parse import parse_fields
    except Exception as e:
        print(f"FAIL import: cannot import parse_fields from parse.py: {type(e).__name__}: {e}")
        return 1

    failed = 0
    for name, line, expected in CASES:
        try:
            got = parse_fields(line)
        except Exception as e:
            print(f"FAIL {name}: raised {type(e).__name__}: {e}")
            failed += 1
            continue
        if got != expected:
            print(f"FAIL {name}: got {got!r}, want {expected!r}")
            failed += 1

    if failed:
        print(f"FAILED: {failed} of {len(CASES)} test cases")
        return 1
    print(f"PASS: all {len(CASES)} test cases")
    return 0


if __name__ == "__main__":
    sys.exit(main())
