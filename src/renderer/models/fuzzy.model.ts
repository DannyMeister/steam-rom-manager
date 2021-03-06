export interface FuzzyListTimestamps {
    check: number,
    download: number
}

export interface FuzzyInfoData {
    info: FuzzyInfo,
    stringA?: string,
    stringB?: string
}

export interface FuzzyErrorData {
    isFatal: boolean,
    error: FuzzyError,
    errorMsg?: string
}

export interface FuzzyTimestampData extends FuzzyListTimestamps { }

export interface FuzzyEventMap {
    info: FuzzyInfoData,
    error: FuzzyErrorData,
    newTimestamps: FuzzyTimestampData
}

export type FuzzyInfo =
    'downloading' |
    'successfulDownload' |
    'checkingIfListIsUpToDate' |
    'listIsOutdated' |
    'listIsUpToDate' |
    'match' |
    'equal' |
    'notEqual';

export type FuzzyError =
    'totalGamesIsUndefined' |
    'unknownError';

export type FuzzyEventCallback = <K extends keyof FuzzyEventMap>(event: K, data: FuzzyEventMap[K]) => void;

export interface ParsedDataWithFuzzy {
    success: {
        filePath: string,
        extractedTitle: string,
        fuzzyTitle: string
    }[],
    failed: string[]
}