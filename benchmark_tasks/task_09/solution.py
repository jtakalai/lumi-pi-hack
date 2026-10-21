def find_all_cycles(graph):
    cycles = []
    visited = set()

    def dfs(node, path):
        visited.add(node)
        for neighbor in graph.get(node, []):
            if neighbor in path:
                cycle = path[path.index(neighbor):] + [neighbor]
                cycles.append(cycle)
            elif neighbor not in visited:
                dfs(neighbor, path + [neighbor])

    for start_node in list(graph.keys()):
        dfs(start_node, [start_node])

    return cycles
