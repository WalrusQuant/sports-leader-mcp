import pandas as pd
import pytest

import sports_leader_lab.splits as splits
from sports_leader_lab.splits import walk_forward
from sports_leader_lab.splits.walk import _assert_time_order


def test_random_splits_are_not_exposed():
    assert splits.__all__ == ["Fold", "walk_forward"]
    assert not hasattr(splits, "train_test_split")
    with pytest.raises(ValueError, match="random splits are not available"):
        walk_forward(_frame([]), scheme="random")


def test_season_folds_and_descriptions():
    frame = _frame(
        [
            ("2021-06-01", 2021),
            ("2021-06-20", 2021),
            ("2022-06-01", 2022),
            ("2022-06-20", 2022),
            ("2023-06-01", 2023),
        ]
    )
    folds = walk_forward(frame, scheme="season", min_train_seasons=2)
    assert len(folds) == 1
    fold = folds[0]
    assert fold.train_seasons == (2021, 2022)
    assert fold.test_seasons == (2023,)
    assert fold.train_rows == 4
    assert fold.test_rows == 1
    assert fold.describe()["train_start"] == "2021-06-01"
    assert fold.describe()["test_end"] == "2023-06-01"
    _assert_order(frame, fold)

    early = walk_forward(frame, scheme="season", min_train_seasons=1)
    assert [fold.test_seasons for fold in early] == [(2022,), (2023,)]
    assert early[0].train_rows == 2
    assert early[1].train_rows == 4


def test_embargo_drops_the_tail_of_training_and_overlap_fails():
    frame = _frame([("2022-05-20", 2021), ("2022-05-30", 2021), ("2022-06-02", 2022)])
    fold = walk_forward(frame, scheme="season", min_train_seasons=1, embargo_days=7)[0]
    train_dates = set(frame.iloc[list(fold.train_iloc)]["game_date"])
    assert train_dates == {"2022-05-20"}
    assert fold.test_rows == 1
    _assert_order(frame, fold)
    assert (fold.test_start - fold.train_end).days >= 8


def test_embargo_of_zero_and_one_are_different():
    frame = _frame([("2022-06-01", 2021), ("2022-06-02", 2021), ("2022-06-03", 2022)])
    zero = walk_forward(frame, scheme="season", min_train_seasons=1, embargo_days=0)[0]
    one = walk_forward(frame, scheme="season", min_train_seasons=1, embargo_days=1)[0]
    assert set(frame.iloc[list(zero.train_iloc)]["game_date"]) == {"2022-06-01", "2022-06-02"}
    assert set(frame.iloc[list(one.train_iloc)]["game_date"]) == {"2022-06-01"}
    assert (zero.test_start - zero.train_end).days == 1
    assert (one.test_start - one.train_end).days == 2

    # A prior-season game dated after the test season starts is not training data.
    overlap = _frame([("2022-05-01", 2021), ("2022-06-10", 2021), ("2022-06-01", 2022)])
    kept = walk_forward(overlap, scheme="season", min_train_seasons=1)[0]
    assert set(overlap.iloc[list(kept.train_iloc)]["game_date"]) == {"2022-05-01"}
    _assert_order(overlap, kept)
    with pytest.raises(AssertionError, match="not after every train date"):
        _assert_time_order(
            pd.Series([pd.Timestamp("2022-06-10")]),
            pd.Series([pd.Timestamp("2022-06-01")]),
            0,
            0,
        )


def test_date_folds_expand_with_an_embargo_gap():
    # Ten days labeled 2021, then twenty labeled 2022, with no offseason gap.
    # Embargo of 2 full days makes 2022-01-04 the first date with a training row.
    rows = [("2022-01-%02d" % day, 2021) for day in range(1, 11)]
    rows += [("2022-01-%02d" % day, 2022) for day in range(11, 31)]
    frame = _frame(rows)
    folds = walk_forward(frame, scheme="date", min_train_seasons=1, embargo_days=2, test_days=10)
    assert [(fold.test_start.isoformat(), fold.test_end.isoformat(), fold.train_rows, fold.test_rows) for fold in folds] == [
        ("2022-01-04", "2022-01-13", 1, 10),
        ("2022-01-14", "2022-01-23", 11, 10),
        ("2022-01-24", "2022-01-30", 21, 7),
    ]
    # Jan 12 is inside the embargo before the Jan 14 window, so it is in neither side.
    january_12 = frame.index[frame["game_date"] == "2022-01-12"].tolist()
    assert january_12[0] not in folds[1].train_iloc
    assert january_12[0] not in folds[1].test_iloc
    assert folds[0].train_seasons == (2021,)
    assert folds[1].train_seasons == (2021, 2022)
    for fold in folds:
        _assert_order(frame, fold)
        assert (fold.test_start - fold.train_end).days >= 3

    later = walk_forward(frame, scheme="date", min_train_seasons=2, embargo_days=2, test_days=10)
    assert [fold.test_start.isoformat() for fold in later] == ["2022-01-14", "2022-01-24"]
    assert all(fold.train_seasons == (2021, 2022) for fold in later)


def test_date_folds_skip_windows_below_the_minimum_train_rows():
    rows = [("2022-01-%02d" % day, 2021) for day in range(1, 31)]
    frame = _frame(rows)
    folds = walk_forward(
        frame,
        scheme="date",
        min_train_seasons=1,
        min_train_rows=12,
        embargo_days=0,
        test_days=10,
    )
    assert [fold.test_start.isoformat() for fold in folds] == ["2022-01-13", "2022-01-23"]
    assert all(fold.train_rows >= 12 for fold in folds)
    assert folds[0].train_rows == 12
    assert folds[0].describe()["min_train_rows"] == 12


def _frame(rows: list[tuple[str, int]]) -> pd.DataFrame:
    return pd.DataFrame(
        [{"game_date": day, "season": season, "game_id": index} for index, (day, season) in enumerate(rows)]
    )


def _assert_order(frame: pd.DataFrame, fold) -> None:
    train = pd.to_datetime(frame.iloc[list(fold.train_iloc)]["game_date"])
    test = pd.to_datetime(frame.iloc[list(fold.test_iloc)]["game_date"])
    assert train.max() < test.min()
    assert fold.train_rows == len(fold.train_iloc)
    assert fold.test_rows == len(fold.test_iloc)
    assert set(fold.train_iloc).isdisjoint(fold.test_iloc)
    description = fold.describe()
    assert description["train_rows"] == fold.train_rows
    assert description["test_rows"] == fold.test_rows
    assert "train_start" in description and "test_end" in description
