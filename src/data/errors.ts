/** Failure talking to or reading the private Parquet export. */
export class DataExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataExportError";
  }
}

/** Downloaded bytes do not match the manifest sha256. */
export class ChecksumMismatchError extends DataExportError {
  readonly filePath: string;

  constructor(filePath: string) {
    super(`checksum mismatch for ${filePath} (download does not match the manifest sha256)`);
    this.name = "ChecksumMismatchError";
    this.filePath = filePath;
  }
}
