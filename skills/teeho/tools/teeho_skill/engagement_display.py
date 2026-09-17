"""参考笔记互动数量的固定展示档位。"""

from types import MappingProxyType
from typing import Optional, Union

ENGAGEMENT_TIERS = MappingProxyType({
    "likes": ((100_000, "10W+"), (10_000, "1W+"), (1_000, "1K+"), (100, "100+")),
    "collects": ((10_000, "1W+"), (5_000, "5K+"), (1_000, "1K+"), (100, "100+")),
    "comments": ((1_000, "1000+"), (100, "100+"), (10, "10+")),
})


def engagement_tier(metric: str, count: Optional[Union[int, float]]) -> Optional[str]:
    """返回数量档位；低数量或缺失值交由调用方提供本地化提示。"""
    return next(
        (label for minimum, label in ENGAGEMENT_TIERS[metric]
         if count is not None and count >= minimum),
        None,
    )
