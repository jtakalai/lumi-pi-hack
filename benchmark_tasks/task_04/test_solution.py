from solution import run_length_encode

def test_run_length_encode():
    assert run_length_encode("AAABBBCC") == "A3B3C2"
    assert run_length_encode("ABCD") == "A1B1C1D1"
    assert run_length_encode("") == ""
