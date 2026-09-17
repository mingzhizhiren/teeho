"""六维十分制文本图；缺失点不绘制、不连线。"""

import math
from typing import Optional

WIDTH = 35
HEIGHT = 17
CENTER_X = 17
CENTER_Y = 8
RADIUS_X = 12
RADIUS_Y = 7
METRIC_COUNT = 6
MAX_SCORE = 10


def radar_plot(scores: list[Optional[float]]) -> list[str]:
    """外围六边形是网格，实心点及线段只代表已有数据。"""
    canvas = [[" " for _ in range(WIDTH)] for _ in range(HEIGHT)]

    def point(index: int, score: float) -> tuple[int, int]:
        angle = -math.pi / 2 + index * math.tau / METRIC_COUNT
        scale = min(MAX_SCORE, max(0, score)) / MAX_SCORE
        return (round(CENTER_X + math.cos(angle) * RADIUS_X * scale),
                round(CENTER_Y + math.sin(angle) * RADIUS_Y * scale))

    def line(a: tuple[int, int], b: tuple[int, int], grid: bool = False) -> None:
        dx, dy = b[0] - a[0], b[1] - a[1]
        steps = max(abs(dx), abs(dy), 1)
        mark = "·" if grid else "│" if dx == 0 else "─" if dy == 0 else "╲" if dx * dy > 0 else "╱"
        for step in range(steps + 1):
            x, y = round(a[0] + dx * step / steps), round(a[1] + dy * step / steps)
            canvas[y][x] = mark

    grid_points = [point(index, MAX_SCORE) for index in range(METRIC_COUNT)]
    for index in range(METRIC_COUNT):
        line(grid_points[index], grid_points[(index + 1) % METRIC_COUNT], grid=True)
    values = [None if score is None else point(index, score) for index, score in enumerate(scores)]
    for index, current in enumerate(values):
        following = values[(index + 1) % METRIC_COUNT]
        if current is not None and following is not None:
            line(current, following)
    for current in values:
        if current is not None:
            canvas[current[1]][current[0]] = "●"
    return ["".join(row).rstrip() for row in canvas]
