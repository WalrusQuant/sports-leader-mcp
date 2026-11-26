"""Errors the lab raises. Messages name datasets and seasons, not download URLs."""


class LabError(Exception):
    """Base error for the lab."""


class ConfigError(LabError):
    """An environment setting is missing or invalid."""


class DataError(LabError):
    """The manifest, a file, or a requested league/dataset/season cannot be used."""


class ChecksumMismatch(DataError):
    """Downloaded bytes do not match the manifest sha256. The file is not kept."""
