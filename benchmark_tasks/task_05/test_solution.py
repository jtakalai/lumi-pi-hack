from solution import flatten_dict

def test_flatten_dict():
    raw = {"a": 1, "b": {"c": 2, "d": {"e": 3}}}
    expected = {"a": 1, "b.c": 2, "b.d.e": 3}
    assert flatten_dict(raw) == expected
