from solution import filter_active_users

def test_filter_active_users():
    data = [
        {"name": "Alice", "active": True},
        {"name": "Bob"},
        {"name": "Charlie", "active": False},
        {"name": "Dave", "active": True},
    ]
    assert filter_active_users(data) == ["Alice", "Dave"]
