import { UPDATE_CHECK_PERIODS, type UpdateCheckPeriod } from '@/features/updates/model/app-update-policy';

export const UPDATE_CHECK_PERIOD_OPTIONS: { value: UpdateCheckPeriod }[] = UPDATE_CHECK_PERIODS.map((value) => ({ value }));
