class LRUCache:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.cache = {}

    def get(self, key: int) -> int:
        if key not in self.cache:
            return -1
        return self.cache[key]

    def put(self, key: int, value: int) -> None:
        if len(self.cache) >= self.capacity and key not in self.cache:
            first_key = next(iter(self.cache))
            del self.cache[first_key]
        self.cache[key] = value
