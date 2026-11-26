"""Leakage-safe feature registry.

Every built-in family declares `known_at`. Rolling and EWMA form are shifted
one game. Rest and travel use the schedule only. Elo is the rating before
the game. Probables and injury counts join at start time.
"""

from sports_leader_lab.features.registry import (
    BuiltFeatures,
    FeatureRegistry,
    FeatureSpec,
    KnownAt,
    build_features,
    default_registry,
)

__all__ = [
    "BuiltFeatures",
    "FeatureRegistry",
    "FeatureSpec",
    "KnownAt",
    "build_features",
    "default_registry",
]
