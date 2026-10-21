from solution import calculate_discount

def test_calculate_discount():
    assert calculate_discount(100, 0.2) == 80.0
    assert calculate_discount(50, 0.1) == 45.0
