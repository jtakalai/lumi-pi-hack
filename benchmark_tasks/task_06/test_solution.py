from solution import compare_versions

def test_compare_versions():
    assert compare_versions("1.2", "1.2.0") == 0
    assert compare_versions("1.10", "1.2") == 1
    assert compare_versions("2.0.1", "2.1") == -1
    assert compare_versions("1.0.0.0", "1.0") == 0
