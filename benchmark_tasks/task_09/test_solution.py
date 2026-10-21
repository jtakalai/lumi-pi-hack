from solution import find_all_cycles

def test_find_all_cycles():
    graph = {
        "A": ["B"],
        "B": ["C"],
        "C": ["A", "D"],
        "D": ["E"],
        "E": ["D"],
    }
    raw_cycles = find_all_cycles(graph)
    norm_cycles = set(tuple(c[:-1]) for c in raw_cycles)
    assert len(norm_cycles) == 2
    assert ("A", "B", "C") in norm_cycles or ("B", "C", "A") in norm_cycles or ("C", "A", "B") in norm_cycles
    assert ("D", "E") in norm_cycles or ("E", "D") in norm_cycles
