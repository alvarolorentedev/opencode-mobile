export const checkForUpdate = async () => ({ updateAvailable: false, immediateAllowed: false, updateInProgress: false, storeVersion: undefined });
export const startUpdate = async (_immediate?: boolean) => false;
export const addUpdateListener = (_event: string, _callback: unknown) => () => {};
