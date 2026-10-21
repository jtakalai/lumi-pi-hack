from solution import merge_intervals

def test_merge_intervals():
    assert merge_intervals([(1, 3), (2, 6), (8, 10), (15, 18)]) == [(1, 6), (8, 10), (15, 18)]
    assert merge_intervals([(1, 4), (4, 5)]) == [(1, 5)]
    assert merge_intervals([(1, 4), (0, 4)]) == [(0, 4)]
    assert merge_intervals([]) == []
