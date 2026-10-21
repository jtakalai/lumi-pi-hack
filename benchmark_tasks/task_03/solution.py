def filter_active_users(users):
    return [u["name"] for u in users if u["active"]]
