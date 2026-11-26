"""Season folds and date folds. Every test date is after every train date."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

import pandas as pd

Scheme = Literal["season", "date"]


@dataclass(frozen=True)
class Fold:
    fold: int
    scheme: str
    train_start: date
    train_end: date
    test_start: date
    test_end: date
    embargo_days: int
    train_rows: int
    test_rows: int
    train_seasons: tuple[int, ...]
    test_seasons: tuple[int, ...]
    min_train_seasons: int
    train_iloc: tuple[int, ...]
    test_iloc: tuple[int, ...]

    def describe(self) -> dict[str, object]:
        return {
            "fold": self.fold,
            "scheme": self.scheme,
            "train_start": self.train_start.isoformat(),
            "train_end": self.train_end.isoformat(),
            "test_start": self.test_start.isoformat(),
            "test_end": self.test_end.isoformat(),
            "embargo_days": self.embargo_days,
            "train_rows": self.train_rows,
            "test_rows": self.test_rows,
            "train_seasons": list(self.train_seasons),
            "test_seasons": list(self.test_seasons),
            "min_train_seasons": self.min_train_seasons,
        }


def walk_forward(
    frame: pd.DataFrame,
    *,
    scheme: str,
    date_col: str = "game_date",
    season_col: str = "season",
    min_train_seasons: int = 2,
    embargo_days: int = 0,
    test_days: int = 14,
) -> list[Fold]:
    """Expanding walk-forward folds.

    `scheme='season'` trains on earlier seasons and tests the next one.
    `scheme='date'` walks calendar windows of `test_days`. The first window
    starts on the first date whose embargoed history already contains
    `min_train_seasons` distinct seasons, and later windows step forward
    from there. `embargo_days` drops the training rows immediately before
    each test window.

    A random or shuffled split is not available.
    """
    kind = _scheme(scheme)
    if min_train_seasons < 1:
        raise ValueError("min_train_seasons must be >= 1")
    if embargo_days < 0:
        raise ValueError("embargo_days must be >= 0")
    if kind == "date" and test_days < 1:
        raise ValueError("test_days must be >= 1")
    if frame.empty:
        raise ValueError("frame is empty")
    if date_col not in frame.columns or season_col not in frame.columns:
        raise ValueError(f"frame needs {date_col} and {season_col}")

    work = frame.copy()
    work["_lab_date"] = _dates(work[date_col])
    if work["_lab_date"].isna().any():
        raise ValueError(f"{date_col} has a missing date")
    work["_lab_season"] = _seasons(work[season_col])
    if work["_lab_season"].isna().any():
        raise ValueError(f"{season_col} has a missing season")
    work["_lab_pos"] = range(len(work))
    if kind == "season":
        return _season_folds(work, min_train_seasons, embargo_days)
    return _date_folds(work, min_train_seasons, embargo_days, test_days)


def _scheme(scheme: str) -> Scheme:
    kind = scheme.strip().lower()
    if kind not in {"season", "date"}:
        raise ValueError("random splits are not available; use scheme='season' or scheme='date'")
    return kind  # type: ignore[return-value]


def _season_folds(work: pd.DataFrame, min_train_seasons: int, embargo_days: int) -> list[Fold]:
    seasons = sorted(int(season) for season in work["_lab_season"].unique())
    folds: list[Fold] = []
    for index in range(min_train_seasons, len(seasons)):
        train_seasons = seasons[:index]
        test_season = seasons[index]
        test = work[work["_lab_season"] == test_season]
        if test.empty:
            continue
        test_start = test["_lab_date"].min()
        train = work[
            work["_lab_season"].isin(train_seasons) & _train_mask(work["_lab_date"], test_start, embargo_days)
        ]
        if train.empty:
            continue
        folds.append(_make_fold(len(folds), "season", train, test, embargo_days, min_train_seasons))
    return folds


def _date_folds(
    work: pd.DataFrame,
    min_train_seasons: int,
    embargo_days: int,
    test_days: int,
) -> list[Fold]:
    unique_dates = sorted(pd.Timestamp(value) for value in work["_lab_date"].unique())
    origin: pd.Timestamp | None = None
    for day in unique_dates:
        history = work[_train_mask(work["_lab_date"], day, embargo_days)]
        if len(history) and history["_lab_season"].nunique() >= min_train_seasons:
            origin = day
            break
    if origin is None:
        return []
    folds: list[Fold] = []
    start = origin
    last = unique_dates[-1]
    step = pd.Timedelta(days=test_days)
    while start <= last:
        end = start + step
        test = work[(work["_lab_date"] >= start) & (work["_lab_date"] < end)]
        start = end
        if test.empty:
            continue
        test_start = pd.Timestamp(test["_lab_date"].min())
        train = work[_train_mask(work["_lab_date"], test_start, embargo_days)]
        if train.empty or train["_lab_season"].nunique() < min_train_seasons:
            continue
        folds.append(_make_fold(len(folds), "date", train, test, embargo_days, min_train_seasons))
    return folds


def _make_fold(
    number: int,
    scheme: str,
    train: pd.DataFrame,
    test: pd.DataFrame,
    embargo_days: int,
    min_train_seasons: int,
) -> Fold:
    _assert_time_order(train["_lab_date"], test["_lab_date"], embargo_days, number)
    overlap = set(train["_lab_pos"]).intersection(test["_lab_pos"])
    if overlap:
        raise AssertionError(f"fold {number} has rows in both train and test")
    return Fold(
        fold=number,
        scheme=scheme,
        train_start=_as_date(train["_lab_date"].min()),
        train_end=_as_date(train["_lab_date"].max()),
        test_start=_as_date(test["_lab_date"].min()),
        test_end=_as_date(test["_lab_date"].max()),
        embargo_days=embargo_days,
        train_rows=int(len(train)),
        test_rows=int(len(test)),
        train_seasons=tuple(sorted(int(season) for season in train["_lab_season"].unique())),
        test_seasons=tuple(sorted(int(season) for season in test["_lab_season"].unique())),
        min_train_seasons=min_train_seasons,
        train_iloc=tuple(int(pos) for pos in train["_lab_pos"].tolist()),
        test_iloc=tuple(int(pos) for pos in test["_lab_pos"].tolist()),
    )


def _assert_time_order(
    train_dates: pd.Series,
    test_dates: pd.Series,
    embargo_days: int,
    fold_id: int,
) -> None:
    if train_dates.empty or test_dates.empty:
        raise AssertionError(f"fold {fold_id} is empty")
    train_end = pd.Timestamp(train_dates.max())
    test_start = pd.Timestamp(test_dates.min())
    if train_end >= test_start:
        raise AssertionError(
            f"fold {fold_id}: test date {test_start.date().isoformat()} is not after every "
            f"train date (train ends {train_end.date().isoformat()})"
        )
    gap = (test_start - train_end).days
    if gap < embargo_days:
        raise AssertionError(f"fold {fold_id}: embargo is {embargo_days} days but the gap is {gap}")


def _train_mask(dates: pd.Series, test_start: pd.Timestamp, embargo_days: int) -> pd.Series:
    start = pd.Timestamp(test_start)
    if embargo_days <= 0:
        return dates < start
    return dates <= start - pd.Timedelta(days=embargo_days)


def _dates(series: pd.Series) -> pd.Series:
    converted = pd.to_datetime(series, errors="coerce", utc=True)
    return converted.dt.tz_convert("UTC").dt.tz_localize(None).dt.normalize()


def _seasons(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


def _as_date(value: object) -> date:
    stamp = pd.Timestamp(value)
    if stamp is pd.NaT or pd.isna(stamp):
        raise ValueError("fold date is missing")
    py = stamp.to_pydatetime()
    if not isinstance(py, datetime):
        raise ValueError("fold date is missing")
    return py.date()
